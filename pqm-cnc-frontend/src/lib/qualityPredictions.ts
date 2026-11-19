import type {
  BalloonPrediction,
  BalloonRisk,
  DrawingBalloon,
  QualityTrendPoint,
} from "@/domain/opsDashboard";

/** Demo: the one balloon whose prediction is live (the backend reports its own id; this is the fallback). */
export const DEFAULT_QUALITY_BALLOON_ID = "b9";

/** Demo: tolerance every series-driven balloon starts with (each can be changed by hand). Matches the backend default. */
export const DEFAULT_SERIES_SPEC = { nominal: 18, upperTol: 0.1, lowerTol: 0.1 } as const;

/** One backend prediction as far as the quality balloon is concerned. */
export type QualityHistoryPoint = {
  index?: number;
  quality?: number;
  timestampUtc: string;
};

/**
 * The backend's fixed series as a finished history for the balloons that are not live: all entries, in order.
 * It never changes with triggers, so the timestamp is a constant.
 */
export function seriesHistory(
  series: readonly { index: number; quality?: number }[] | undefined,
): QualityHistoryPoint[] {
  return (series ?? []).map((item) => ({
    index: item.index,
    quality: item.quality,
    timestampUtc: "1970-01-01T00:00:00.000Z",
  }));
}

type Spec = Pick<DrawingBalloon, "nominal" | "upperTol" | "lowerTol" | "unit">;

/** A flatness-style spec (0 … upper) has no meaningful lower limit. */
const oneSided = (b: Spec) => b.nominal === 0 && b.lowerTol === 0;

function roundFor(value: number, span: number): number {
  const digits = span >= 1 ? 2 : span >= 0.1 ? 3 : 4;
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

/** Outside the band → high risk; inside but within 20% of the band width of a limit → warning. */
export function qualityRisk(value: number, b: Spec): BalloonRisk {
  const span = Math.max(b.upperTol + b.lowerTol, 1e-6);
  const margin = marginToBand(value, b);
  if (margin < 0) return "high_risk";
  return margin < span * 0.2 ? "warning" : "pass";
}

/** Prediction history → trend points for the quality balloon (USL/LSL follow the balloon's tolerance). */
export function qualityTrendFromHistory(
  history: readonly QualityHistoryPoint[],
  balloon: Spec,
): QualityTrendPoint[] {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  return history.flatMap((point, i) =>
    typeof point.quality === "number"
      ? [{
          index: point.index ?? i + 1,
          label: String(point.index ?? i + 1),
          prediction: roundFor(point.quality, span),
          qcValue: null,
          usl: roundFor(usl, span),
          lsl: roundFor(lsl, span),
        }]
      : [],
  );
}

/**
 * Latest prediction → Selected Balloon Detail values (confidence/pass probability are mock estimates).
 * `lastQcValue` / `lastQcAt` are the controller's last measured value for this balloon and when it was measured
 * (null/undefined = none yet).
 */
export function qualityPredictionFromHistory(
  history: readonly QualityHistoryPoint[],
  balloon: Spec & { id: string },
  lastQcValue?: number | null,
  lastQcAt?: string | null,
): BalloonPrediction | null {
  const latest = [...history].reverse().find((point) => typeof point.quality === "number");
  if (!latest || typeof latest.quality !== "number") return null;
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
    lastQcValue: typeof lastQcValue === "number" && Number.isFinite(lastQcValue) ? lastQcValue : null,
    lastQcAt: typeof lastQcValue === "number" && Number.isFinite(lastQcValue) ? (lastQcAt ?? null) : null,
  };
}
