import { describe, expect, it } from "vitest";
import {
  QUALITY_TREND_POINTS,
  QUALITY_TREND_QC_COUNT,
  buildQualityTrend,
  isOutsideControl,
  linkBalloonDetailAndTrend,
} from "./qualityTrend";

describe("buildQualityTrend", () => {
  it("returns 20 historical points with exactly 3 QC measurements", () => {
    const series = buildQualityTrend(
      {
        id: "b17",
        nominal: 20,
        upperTol: 0.02,
        lowerTol: 0.02,
        risk: "high_risk",
      },
      20.028,
    );
    expect(series).toHaveLength(QUALITY_TREND_POINTS);
    expect(series[0].label).toBe("1");
    expect(series[19].label).toBe("20");
    expect(series[19].prediction).toBe(20.028);
    expect(series[19].usl).toBeCloseTo(20.02, 3);
    expect(series.filter((p) => p.qcValue != null)).toHaveLength(
      QUALITY_TREND_QC_COUNT,
    );
  });

  it("places high_risk end point beyond the control window", () => {
    const series = buildQualityTrend({
      id: "b17",
      nominal: 20,
      upperTol: 0.02,
      lowerTol: 0.02,
      risk: "high_risk",
    });
    const last = series[series.length - 1]!;
    expect(isOutsideControl(last.prediction, last.usl, last.lsl)).toBe(true);
  });

  it("is curved and slightly irregular — not a straight line or sine wave", () => {
    const nominal = 10;
    const tol = 0.05;
    const span = tol * 2;
    const series = buildQualityTrend(
      {
        id: "b3",
        nominal,
        upperTol: tol,
        lowerTol: tol,
        risk: "warning",
      },
      10.04,
    );
    const preds = series.map((p) => p.prediction);
    const n = preds.length;
    const first = preds[0]!;
    const last = preds[n - 1]!;

    let maxDevFromChord = 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const chord = first + (last - first) * t;
      maxDevFromChord = Math.max(maxDevFromChord, Math.abs(preds[i]! - chord));
    }
    expect(maxDevFromChord).toBeGreaterThan(span * 0.01);

    let extrema = 0;
    for (let i = 1; i < n - 1; i++) {
      const d0 = preds[i]! - preds[i - 1]!;
      const d1 = preds[i + 1]! - preds[i]!;
      if (d0 === 0 || d1 === 0) continue;
      if (Math.sign(d0) !== Math.sign(d1)) extrema += 1;
    }
    // High-frequency sine would turn often; keep wander mild.
    expect(extrema).toBeLessThanOrEqual(8);
  });
});

describe("linkBalloonDetailAndTrend", () => {
  it("syncs detail prediction with the latest trend point", () => {
    const balloon = {
      id: "b17",
      nominal: 20,
      upperTol: 0.02,
      lowerTol: 0.02,
      risk: "high_risk" as const,
      unit: "mm",
    };
    const { prediction, trend } = linkBalloonDetailAndTrend(
      balloon,
      {
        balloonId: "b17",
        predictedValue: 20.01,
        confidence: 0.91,
        margin: 0.01,
        marginUnit: "mm",
        passProbability: 0.12,
        lastQcValue: null,
      },
      null,
    );
    expect(prediction).not.toBeNull();
    const last = trend[trend.length - 1]!;
    expect(prediction!.predictedValue).toBe(last.prediction);
    expect(isOutsideControl(last.prediction, last.usl, last.lsl)).toBe(true);
    expect(prediction!.margin).toBeLessThan(0);
    expect(trend.filter((p) => p.qcValue != null)).toHaveLength(3);
    expect(prediction!.lastQcValue).not.toBeNull();
  });
});
