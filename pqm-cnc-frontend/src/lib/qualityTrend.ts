import type {
  BalloonPrediction,
  BalloonRisk,
  DrawingBalloon,
  QualityTrendPoint,
} from "@/domain/opsDashboard";

/** Simulated history length — 20 prediction points per balloon. */
export const QUALITY_TREND_POINTS = 20;
/** Actual CMM / QC measurements embedded in the series. */
export const QUALITY_TREND_QC_COUNT = 3;

/**
 * Synthetic prediction/QC history for a balloon (demo).
 * 20 historical prediction points + exactly 3 actual QC measurements.
 * Ends near `endPrediction` when provided; otherwise near nominal with risk-based drift.
 * high_risk ends beyond the control window (outside USL/LSL).
 *
 * Shape: low-degree polynomial drift (≤3) plus small irregular process noise —
 * believable dimensional wander, neither a straight line nor a sine wave.
 * Three measured points break any accidental chord through QC markers.
 */
export function buildQualityTrend(
  balloon: Pick<
    DrawingBalloon,
    "id" | "nominal" | "upperTol" | "lowerTol" | "risk"
  >,
  endPrediction?: number,
): QualityTrendPoint[] {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  const seed = hashId(balloon.id);
  const qcAt = qcSampleIndices(seed, QUALITY_TREND_POINTS);

  const end =
    endPrediction ??
    defaultEndPrediction(balloon.nominal, usl, lsl, balloon.risk, seed);

  const startBias =
    span *
    (balloon.risk === "pass" ? 0.06 : 0.02 + (seed % 5) * 0.004) *
    (seed % 2 === 0 ? 1 : -1);
  const start = balloon.nominal + startBias;

  // Degree-3 blend weights (sum to 1) — gentle curvature, not a chord.
  const w1 = 0.25 + (seed % 3) * 0.05; // linear
  const w2 = 0.35 + ((seed * 2) % 3) * 0.05; // quadratic
  const w3 = Math.max(0.15, 1 - w1 - w2); // cubic

  // Pass still wanders — stable outcome ≠ flat measurements.
  const noiseAmp =
    span *
    (balloon.risk === "pass"
      ? 0.055
      : balloon.risk === "warning"
        ? 0.04
        : 0.048);

  const points: QualityTrendPoint[] = [];
  let ar = 0;
  let qcOrdinal = 0;
  for (let i = 0; i < QUALITY_TREND_POINTS; i++) {
    const t = i / (QUALITY_TREND_POINTS - 1);
    const blend = w1 * t + w2 * t * t + w3 * t * t * t;
    const drift = start + (end - start) * blend;

    // Irregular AR(1) residual (hash noise — not a periodic sine over time).
    const innov = unitNoise(seed, i);
    ar = 0.62 * ar + 0.38 * innov;
    const prediction =
      i === QUALITY_TREND_POINTS - 1 ? end : drift + noiseAmp * ar;

    let qcValue: number | null = null;
    if (qcAt.has(i)) {
      // Stagger residuals so the three QC diamonds are not colinear.
      // Pass cases get larger in-band scatter so “good” still looks alive.
      const stagger = [-0.85, 0.55, -0.35][qcOrdinal % 3]!;
      const qcSpread =
        balloon.risk === "pass"
          ? span * (0.14 + qcOrdinal * 0.05)
          : span * (0.022 + qcOrdinal * 0.008);
      const qcBias =
        qcSpread * (stagger + 0.35 * unitNoise(seed + 11, i));
      qcValue = prediction + qcBias;
      // Keep pass QC inside the control window so status stays “good”.
      if (balloon.risk === "pass") {
        const pad = span * 0.05;
        qcValue = Math.min(usl - pad, Math.max(lsl + pad, qcValue));
      }
      qcOrdinal += 1;
    }

    points.push({
      index: i + 1,
      label: String(i + 1),
      prediction: roundEng(prediction, span),
      qcValue: qcValue == null ? null : roundEng(qcValue, span),
      usl: roundEng(usl, span),
      lsl: roundEng(lsl, span),
    });
  }
  return points;
}

/** Deterministic irregular sample in (-1, 1) — not a time-series sinusoid. */
function unitNoise(seed: number, i: number): number {
  const x = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Three spaced QC sample indices in early / mid / late windows (not the final point). */
function qcSampleIndices(seed: number, n: number): Set<number> {
  const last = n - 1;
  const early = 2 + (seed % 4); // 2–5
  const mid = 8 + ((seed * 3) % 4); // 8–11
  let late = 14 + ((seed * 5) % 4); // 14–17
  if (late >= last) late = last - 1;
  if (late <= mid) late = Math.min(last - 1, mid + 3);
  return new Set([early, mid, late]);
}

/**
 * Keep Selected Balloon Detail and Quality Trend in sync.
 * For high_risk, the latest prediction is forced outside the control window.
 */
export function linkBalloonDetailAndTrend(
  balloon: Pick<
    DrawingBalloon,
    "id" | "nominal" | "upperTol" | "lowerTol" | "risk" | "unit"
  >,
  prediction: BalloonPrediction | null | undefined,
  trend: QualityTrendPoint[] | null | undefined,
): { prediction: BalloonPrediction | null; trend: QualityTrendPoint[] } {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  const seed = hashId(balloon.id);

  if (balloon.risk === "not_machined") {
    const series =
      trend && trend.length > 0
        ? trend.map((p) => ({ ...p }))
        : buildQualityTrend(balloon);
    return { prediction: null, trend: series };
  }

  let end =
    prediction?.predictedValue ??
    (trend && trend.length > 0
      ? trend[trend.length - 1]!.prediction
      : defaultEndPrediction(balloon.nominal, usl, lsl, balloon.risk, seed));

  if (balloon.risk === "high_risk" && !isOutsideControl(end, usl, lsl)) {
    end = defaultEndPrediction(balloon.nominal, usl, lsl, "high_risk", seed);
  }

  end = roundEng(end, span);
  const series = buildQualityTrend(balloon, end);
  const latestQc =
    [...series].reverse().find((p) => p.qcValue != null)?.qcValue ?? null;

  const marginToBand =
    end > usl ? usl - end : end < lsl ? end - lsl : Math.min(usl - end, end - lsl);

  const nextPrediction: BalloonPrediction = {
    balloonId: balloon.id,
    predictedValue: end,
    confidence:
      prediction?.confidence ??
      (balloon.risk === "high_risk" ? 0.91 : balloon.risk === "warning" ? 0.84 : 0.9),
    margin: roundEng(marginToBand, span),
    marginUnit:
      prediction?.marginUnit ?? (balloon.unit === "μm" ? "μm" : "mm"),
    passProbability:
      balloon.risk === "high_risk"
        ? Math.min(prediction?.passProbability ?? 0.12, 0.15)
        : (prediction?.passProbability ??
          (balloon.risk === "warning" ? 0.58 : 0.94)),
    lastQcValue: prediction?.lastQcValue ?? latestQc,
  };

  return { prediction: nextPrediction, trend: series };
}

export function isOutsideControl(
  value: number,
  usl: number,
  lsl: number,
): boolean {
  return value > usl || value < lsl;
}

function defaultEndPrediction(
  nominal: number,
  usl: number,
  lsl: number,
  risk: BalloonRisk,
  seed: number,
): number {
  const span = Math.max(usl - lsl, 1e-6);
  if (risk === "high_risk") {
    // Beyond the control window (outside USL).
    return usl + span * (0.12 + (seed % 5) * 0.02);
  }
  if (risk === "warning") {
    // Inside, near USL.
    return usl - span * (0.18 + (seed % 4) * 0.02);
  }
  if (risk === "not_machined") {
    return nominal;
  }
  // Pass: noticeable offset from nominal (still well inside the band).
  return nominal + span * (0.12 + (seed % 5) * 0.03) * (seed % 2 === 0 ? 1 : -1);
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 97;
}

function roundEng(v: number, span: number): number {
  if (span >= 1) return Math.round(v * 100) / 100;
  if (span >= 0.1) return Math.round(v * 1000) / 1000;
  return Math.round(v * 10000) / 10000;
}
