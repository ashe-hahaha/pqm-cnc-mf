import type {
  BalloonPrediction,
  BalloonRisk,
  DrawingBalloon,
  QualityTrendPoint,
} from "@/domain/opsDashboard";

/** One backend prediction as far as the quality balloon is concerned. */
export type QualityHistoryPoint = {
  index?: number;
  quality?: number;
  timestampUtc: string;
};

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

/** Latest prediction → Selected Balloon Detail values (confidence/pass probability are mock estimates). */
export function qualityPredictionFromHistory(
  history: readonly QualityHistoryPoint[],
  balloon: Spec & { id: string },
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
    lastQcValue: null,
  };
}
