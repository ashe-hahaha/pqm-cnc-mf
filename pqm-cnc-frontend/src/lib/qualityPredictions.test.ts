import { describe, expect, it } from "vitest";
import {
  qualityPredictionFromHistory,
  qualityRisk,
  qualityTrendFromHistory,
} from "./qualityPredictions";

const b1 = { id: "b1", nominal: 0, upperTol: 0.02, lowerTol: 0, unit: "mm" };
const at = (quality: number, index: number) => ({ quality, index, timestampUtc: "2026-11-11T00:00:00Z" });

describe("quality predictions from backend history", () => {
  it("maps history to trend points with the balloon's USL/LSL", () => {
    const trend = qualityTrendFromHistory([at(0.005, 1), at(0.027, 10)], b1);
    expect(trend.map((p) => p.prediction)).toEqual([0.005, 0.027]);
    expect(trend[0]).toMatchObject({ index: 1, label: "1", usl: 0.02, lsl: 0, qcValue: null });
  });

  it("returns nothing before the first prediction", () => {
    expect(qualityTrendFromHistory([], b1)).toEqual([]);
    expect(qualityPredictionFromHistory([], b1)).toBeNull();
  });

  it("classifies normal, near-limit and out-of-band values", () => {
    expect(qualityRisk(0.008, b1)).toBe("pass");
    expect(qualityRisk(0.018, b1)).toBe("warning");
    expect(qualityRisk(0.027, b1)).toBe("high_risk");
  });

  it("uses the latest value for the detail panel, with a negative margin when out of band", () => {
    const normal = qualityPredictionFromHistory([at(0.008, 9)], b1)!;
    expect(normal.predictedValue).toBe(0.008);
    expect(normal.margin).toBeCloseTo(0.012, 4);
    const abnormal = qualityPredictionFromHistory([at(0.008, 9), at(0.027, 10)], b1)!;
    expect(abnormal.predictedValue).toBe(0.027);
    expect(abnormal.margin).toBeLessThan(0);
    expect(abnormal.passProbability).toBeLessThan(0.5);
  });

  it("follows a changed tolerance", () => {
    const wider = { ...b1, upperTol: 0.05 };
    expect(qualityTrendFromHistory([at(0.027, 10)], wider)[0]!.usl).toBe(0.05);
    expect(qualityRisk(0.027, wider)).toBe("pass");
  });
});
