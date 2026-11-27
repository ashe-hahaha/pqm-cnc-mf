import type {
  BalloonPrediction,
  BalloonRisk,
  DrawingBalloon,
  QualityTrendPoint,
} from "@/domain/opsDashboard";

/** Demo: the one balloon whose prediction is live (the backend reports its own id; this is the fallback). */
export const DEFAULT_QUALITY_BALLOON_ID = "b9";

/** Demo: tolerance every series-driven balloon starts with (each can be changed by hand). Matches the backend default. */
export const DEFAULT_SERIES_SPEC = { nominal: 18, upperTol: 0.04, lowerTol: 0.04 } as const;

/** Demo phase colour underneath the purple cutting overlay. */
export function demoBalloonRisk(cutting?: {
  run: number; status: "waiting" | "pending" | "cutting" | "finished";
}): BalloonRisk {
  if (!cutting) return "not_machined";
  if (cutting.run === 2) return cutting.status === "finished" ? "pass" : "high_risk";
  return cutting.status === "finished" ? "high_risk" : "not_machined";
}

/** One backend prediction as far as the quality balloon is concerned. */
export type QualityHistoryPoint = {
  predictionId?: string;
  index?: number;
  quality?: number;
  qcValue?: number | null;
  timestampUtc: string;
};

/**
 * The backend's fixed series as a finished history for the balloons that are not live: all entries, in order.
 * Dates are supplied by the backend alongside the fixed values.
 */
export function seriesHistory(
  series: readonly { index: number; quality?: number; qcValue?: number | null; timestampUtc?: string }[] | undefined,
): QualityHistoryPoint[] {
  return (series ?? []).map((item) => ({
    index: item.index,
    quality: item.quality,
    qcValue: item.qcValue ?? undefined,
    timestampUtc: item.timestampUtc ?? "1970-01-01T00:00:00.000Z",
  }));
}

type Spec = Pick<DrawingBalloon, "nominal" | "upperTol" | "lowerTol" | "unit">;

/** Prefer a balloon's own history; drawing imports may have different ids but retain B1–B8 codes. */
export function fixedQualityHistory(
  balloon: Pick<DrawingBalloon, "id" | "code">,
  histories: Record<string, { index: number; quality: number; qcValue?: number | null; timestampUtc?: string }[]> | undefined,
  fallback: QualityHistoryPoint[],
): QualityHistoryPoint[] {
  const code = balloon.code.trim().toLowerCase().replace(/^b?0*([1-8])$/, "b$1");
  const series = histories?.[balloon.id.toLowerCase()] ?? histories?.[code];
  return series ? seriesHistory(series) : fallback;
}

/** A flatness-style spec (0 … upper) has no meaningful lower limit. */
const oneSided = (b: Spec) => b.nominal === 0 && b.lowerTol === 0;

function roundFor(value: number, span: number): number {
  const digits = 5;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** Distance to the nearest limit; negative once the value is outside the band. */
function marginToBand(value: number, b: Spec): number {
  const usl = b.nominal + b.upperTol;
  const lsl = b.nominal - b.lowerTol;
  if (value > usl) return usl - value;
  if (!oneSided(b) && value < lsl) return value - lsl;
  return oneSided(b) ? usl - value : Math.min(usl - value, value - lsl);
}

/** Outside the band → high risk; inside but within 5% of the band width of a limit → warning. */
export function qualityRisk(value: number, b: Spec): BalloonRisk {
  const span = Math.max(b.upperTol + b.lowerTol, 1e-6);
  const margin = marginToBand(value, b);
  if (margin < 0) return "high_risk";
  return margin < span * 0.05 ? "warning" : "pass";
}

/** Prediction history → trend points for the quality balloon (USL/LSL follow the balloon's tolerance). */
export function qualityTrendFromHistory(
  history: readonly QualityHistoryPoint[],
  balloon: Spec,
  measurement?: { value: number; predictionId?: string | null } | null,
): QualityTrendPoint[] {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  return history.flatMap((point, i) =>
    typeof point.quality === "number"
      ? [{
          index: point.index ?? i + 1,
          label: String(point.index ?? i + 1),
          timestampUtc: point.timestampUtc,
          prediction: roundFor(point.quality, span),
          qcValue: measurement?.predictionId && point.predictionId === measurement.predictionId
            ? roundFor(measurement.value, span)
            : typeof point.qcValue === "number" ? roundFor(point.qcValue, span) : null,
          usl: roundFor(usl, span),
          lsl: roundFor(lsl, span),
        }]
      : [],
  );
}

/**
 * Latest prediction → Selected Balloon Detail values (confidence/pass probability are mock estimates).
 * `lastQcValue` / `lastQcAt` are the controller's last measured value for this balloon and when it was measured
 * When no real QC is available, use this balloon's last historical measurement.
 */
export function qualityPredictionFromHistory(
  history: readonly QualityHistoryPoint[],
  balloon: Spec & { id: string },
  lastQcValue?: number | null,
  lastQcAt?: string | null,
): BalloonPrediction | null {
  const latest = [...history].reverse().find((point) => typeof point.quality === "number");
  if (!latest || typeof latest.quality !== "number") return null;
  const historicalQc = [...history].reverse().find((point) =>
    typeof point.qcValue === "number" && Number.isFinite(point.qcValue));
  const hasRealQc = typeof lastQcValue === "number" && Number.isFinite(lastQcValue);
  const span = Math.max(balloon.upperTol + balloon.lowerTol, 1e-6);
  const margin = marginToBand(latest.quality, balloon);
  return {
    balloonId: balloon.id,
    predictedValue: roundFor(latest.quality, span),
    confidence: 0.9,
    margin: roundFor(margin, span),
    marginUnit: balloon.unit === "μm" ? "μm" : "mm",
    passProbability:
      margin < 0 ? 0.1 : Math.min(0.99, 0.5 + 0.49 * Math.min(1, margin / (span * 0.5))),
    lastQcValue: hasRealQc ? lastQcValue : historicalQc?.qcValue ?? null,
    lastQcAt: hasRealQc ? (lastQcAt ?? null) : historicalQc?.timestampUtc ?? null,
  };
}
