import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERIES_SPEC,
  demoBalloonRisk,
  qualityPredictionFromHistory,
  qualityRisk,
  qualityTrendFromHistory,
  seriesHistory,
} from "./qualityPredictions";

const b1 = { id: "b1", nominal: 0, upperTol: 0.02, lowerTol: 0, unit: "mm" };
const at = (quality: number, index: number) => ({ quality, index, timestampUtc: "2026-11-11T00:00:00Z" });

it("colours B9 by demo run phase, keeping red through inspection and the second-run delay", () => {
  expect(demoBalloonRisk()).toBe("not_machined");
  expect(demoBalloonRisk({ run: 1, status: "waiting" })).toBe("not_machined");
  // Cutting itself is rendered with the drawing's existing purple override.
  expect(demoBalloonRisk({ run: 1, status: "cutting" })).toBe("not_machined");
  expect(demoBalloonRisk({ run: 1, status: "finished" })).toBe("high_risk");
  expect(demoBalloonRisk({ run: 2, status: "pending" })).toBe("high_risk");
  expect(demoBalloonRisk({ run: 2, status: "cutting" })).toBe("high_risk");
  expect(demoBalloonRisk({ run: 2, status: "finished" })).toBe("pass");
  expect(demoBalloonRisk({ run: 1, status: "waiting" })).toBe("not_machined");
});

describe("quality predictions from backend history", () => {
  it("attaches one QC marker by prediction id even when sequence indexes repeat", () => {
    const history = [{ ...at(18.01, 1), predictionId: "old" }, { ...at(18.02, 1), predictionId: "rework" }];
    const spec = { unit: "mm", ...DEFAULT_SERIES_SPEC };
    expect(qualityTrendFromHistory(history, spec, { value: 18.067, predictionId: "rework" }).map(p => p.qcValue)).toEqual([null, 18.067]);
    expect(qualityTrendFromHistory(history, spec, { value: 18.067, predictionId: null }).map(p => p.qcValue)).toEqual([null, null]);
  });
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

  it("passes the controller's last measured value through to Last QC", () => {
    expect(qualityPredictionFromHistory([at(0.008, 9)], b1)!.lastQcValue).toBeNull();
    expect(qualityPredictionFromHistory([at(0.008, 9)], b1, null)!.lastQcValue).toBeNull();
    expect(qualityPredictionFromHistory([at(0.008, 9)], b1, Number.NaN)!.lastQcValue).toBeNull();
    expect(qualityPredictionFromHistory([at(0.008, 9)], b1, 0.012)!.lastQcValue).toBe(0.012);
    const stamped = qualityPredictionFromHistory([at(0.008, 9)], b1, 0.012, "2026-11-12T02:31:02.000Z")!;
    expect(stamped.lastQcAt).toBe("2026-11-12T02:31:02.000Z");
    expect(qualityPredictionFromHistory([at(0.008, 9)], b1, null, "2026-11-12T02:31:02.000Z")!.lastQcAt).toBeNull();
  });

  it("follows a changed tolerance", () => {
    const wider = { ...b1, upperTol: 0.05 };
    expect(qualityTrendFromHistory([at(0.027, 10)], wider)[0]!.usl).toBe(0.05);
    expect(qualityRisk(0.027, wider)).toBe("pass");
  });
});

describe("seriesHistory (fixed record of the balloons that are not live)", () => {
  it("adds mock measurements at samples 3, 6 and 9 only, aligned with their predictions", () => {
    const history = seriesHistory(Array.from({ length: 10 }, (_, i) => ({ index: i + 1, quality: 18 + i * 0.001 })));
    const trend = qualityTrendFromHistory(history, { unit: "mm", ...DEFAULT_SERIES_SPEC });
    const measured = trend.filter(point => point.qcValue !== null);
    expect(measured.map(point => point.index)).toEqual([3, 6, 9]);
    expect(measured.every(point => point.qcValue === point.prediction)).toBe(true);
    expect(qualityTrendFromHistory([at(18.005, 3)], { unit: "mm", ...DEFAULT_SERIES_SPEC })[0].qcValue).toBeNull();
  });

  it("keeps every series entry in order with a constant timestamp", () => {
    const history = seriesHistory([{ index: 1, quality: 18.005 }, { index: 2, quality: 18.15 }, { index: 3 }]);
    expect(history.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(new Set(history.map((p) => p.timestampUtc)).size).toBe(1);
    expect(seriesHistory(undefined)).toEqual([]);
  });

  it("plots against the default 18 ± 0.1 tolerance and follows a hand-set one", () => {
    const history = seriesHistory([{ index: 9, quality: 18.0088 }, { index: 10, quality: 18.15 }]);
    const balloon = { id: "b3", unit: "mm", ...DEFAULT_SERIES_SPEC };
    const trend = qualityTrendFromHistory(history, balloon);
    expect(trend.map((p) => [p.usl, p.lsl])).toEqual([[18.1, 17.9], [18.1, 17.9]]);
    expect(qualityTrendFromHistory(history, { ...balloon, upperTol: 0.2 })[1].usl).toBe(18.2);
  });
});
