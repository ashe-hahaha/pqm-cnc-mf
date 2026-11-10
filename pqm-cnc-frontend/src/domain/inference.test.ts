import { describe, expect, it } from "vitest";
import {
  buildInProcessPrediction,
  labelFromQualityScore,
  qualityScoreFromDrivers,
} from "./inference";

describe("qualityScoreFromDrivers", () => {
  it("locks golden machine score for mch-mill-03 style drivers", () => {
    // wear 0.55·25 + thermal 0.3·20 + chatter 0.1·40 + load 0.62·10 + cpk0
    // = 13.75 + 6 + 4 + 6.2 = 29.95 → Q 70.1
    expect(
      qualityScoreFromDrivers({
        toolWearRatio: 0.55,
        thermalDriftRatio: 0.3,
        chatterIndex: 0.1,
        lastCpk: 1.4,
        axisLoadPct: 62,
      }),
    ).toBe(70.1);
  });

  it("scores high-risk mill-01 style drivers into critical band", () => {
    const q = qualityScoreFromDrivers({
      toolWearRatio: 0.8,
      thermalDriftRatio: 0.55,
      chatterIndex: 0.35,
      lastCpk: 0.95,
      axisLoadPct: 88,
    });
    expect(q).toBeLessThan(45);
    expect(labelFromQualityScore(q)).toBe("critical");
  });
});

describe("buildInProcessPrediction", () => {
  it("returns machine-keyed prediction with drivers and label", () => {
    const pred = buildInProcessPrediction({
      machineId: "mch-mill-03",
      ts: "2026-08-02T00:00:00.000Z",
      drivers: {
        toolWearRatio: 0.55,
        thermalDriftRatio: 0.3,
        chatterIndex: 0.1,
        lastCpk: 1.4,
        axisLoadPct: 62,
      },
      context: {
        feedMmMin: 1200,
        spindleRpm: 8500,
        toolCode: "T12",
        toolGeometry: "Ø12 endmill 4F",
        widthOfCutMm: 6,
        depthOfCutMm: 1.2,
        material: "Al 6061",
        axisLoadPct: 62,
      },
      signals: {
        vibrationRms: 0.42,
        vibrationBandHz: "800–2k",
        acousticRms: 0.18,
        acousticBandKHz: "8–12",
      },
      currentOpLabel: "Finish bore OD",
    });

    expect(pred.machineId).toBe("mch-mill-03");
    expect(pred.qualityScore).toBe(70.1);
    expect(pred.label).toBe("watch");
    expect(pred.topDrivers.length).toBeGreaterThan(0);
    // axis load 0.62 ranks above tool wear 0.55 for this fixture
    expect(pred.topDrivers.map((d) => d.name)).toContain("tool wear");
    expect(pred.topDrivers[0]?.name).toBe("axis load");
  });
});

describe("labelFromQualityScore", () => {
  it("maps score bands", () => {
    expect(labelFromQualityScore(90)).toBe("ok");
    expect(labelFromQualityScore(70)).toBe("watch");
    expect(labelFromQualityScore(50)).toBe("suspect");
    expect(labelFromQualityScore(30)).toBe("critical");
  });
});
