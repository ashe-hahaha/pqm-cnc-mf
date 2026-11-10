import type { OpsDashboardSnapshot } from "@/domain/opsDashboard";
import { buildProcessTrends } from "@/lib/processTrends";
import { buildQualityTrend } from "@/lib/qualityTrend";

/** Phase D seed matching the operational dashboard template (Valve Body A12). */
export const opsDashboardSeed: OpsDashboardSnapshot = {
  liveAt: "2026-05-01T10:24:36",
  overallQuality: "good",
  job: {
    machineId: "mch-makino-slim3n",
    machineCode: "Makino Slim3n",
    productId: "pf-valve-a12",
    productCode: "VALVE BODY A12",
    workOrder: "WO-20260501-07",
    programName: "OP20_HOLE",
    currentOperation: "Finish Boring",
    currentTool: "T06 (Ø20 Bore)",
    currentBalloonId: "b17",
    material: "SS316L",
    batchCompleted: 23,
    batchTotal: 50,
    inspectedParts: 3,
  },
  balloons: [
    { id: "b1", code: "B1", characteristic: "Datum A flatness", characteristicType: "FLATNESS", featureKind: "Plane", nominal: 0, upperTol: 0.02, lowerTol: 0, unit: "mm", critical: true, xPct: 18, yPct: 22, page: 1, source: "seed", risk: "pass" },
    { id: "b2", code: "B2", characteristic: "Overall length", characteristicType: "LENGTH", featureKind: "Length", nominal: 86, upperTol: 0.05, lowerTol: 0.05, unit: "mm", critical: false, xPct: 42, yPct: 14, page: 1, source: "seed", risk: "pass" },
    { id: "b3", code: "B3", characteristic: "Position", characteristicType: "POSITION", featureKind: "Hole", nominal: 0, upperTol: 0.05, lowerTol: 0, unit: "mm", critical: true, xPct: 62, yPct: 20, page: 1, source: "seed", risk: "warning" },
    { id: "b4", code: "B4", characteristic: "Port ID", characteristicType: "ID", featureKind: "Hole", nominal: 8, upperTol: 0.02, lowerTol: 0.02, unit: "mm", critical: true, xPct: 28, yPct: 34, page: 1, source: "seed", risk: "pass" },
    { id: "b5", code: "B5", characteristic: "Boss OD", characteristicType: "OD", featureKind: "OD", nominal: 32, upperTol: 0.03, lowerTol: 0.03, unit: "mm", critical: false, xPct: 48, yPct: 30, page: 1, source: "seed", risk: "pass" },
    { id: "b6", code: "B6", characteristic: "Roundness", characteristicType: "ROUNDNESS", featureKind: "Hole", nominal: 0, upperTol: 0.01, lowerTol: 0, unit: "mm", critical: true, xPct: 72, yPct: 36, page: 1, source: "seed", risk: "pass" },
    { id: "b7", code: "B7", characteristic: "Depth", characteristicType: "LENGTH", featureKind: "Pocket", nominal: 12, upperTol: 0.05, lowerTol: 0.05, unit: "mm", critical: false, xPct: 22, yPct: 52, page: 1, source: "seed", risk: "pass" },
    { id: "b8", code: "B8", characteristic: "Wall thickness", characteristicType: "LENGTH", featureKind: "Wall", nominal: 4.5, upperTol: 0.1, lowerTol: 0.1, unit: "mm", critical: false, xPct: 38, yPct: 48, page: 1, source: "seed", risk: "pass" },
    { id: "b9", code: "B9", characteristic: "Surface Ra", characteristicType: "SURFACE_RA", featureKind: "Surface", nominal: 1.6, upperTol: 0.4, lowerTol: 0, unit: "μm", critical: false, xPct: 58, yPct: 50, page: 1, source: "seed", risk: "pass" },
    { id: "b10", code: "B10", characteristic: "Slot width", characteristicType: "LENGTH", featureKind: "Slot", nominal: 6, upperTol: 0.03, lowerTol: 0.03, unit: "mm", critical: true, xPct: 78, yPct: 54, page: 1, source: "seed", risk: "pass" },
    { id: "b11", code: "B11", characteristic: "Counterbore", characteristicType: "ID", featureKind: "Hole", nominal: 10, upperTol: 0.02, lowerTol: 0.02, unit: "mm", critical: true, xPct: 30, yPct: 68, page: 1, source: "seed", risk: "pass" },
    { id: "b17", code: "B17", characteristic: "Diameter", characteristicType: "OD", featureKind: "Hole", nominal: 20, upperTol: 0.02, lowerTol: 0.02, unit: "mm", critical: true, xPct: 52, yPct: 58, page: 1, source: "seed", risk: "high_risk" },
  ],
  predictions: {
    b3: {
      balloonId: "b3",
      predictedValue: 0.042,
      confidence: 0.84,
      margin: 0.008,
      marginUnit: "mm",
      passProbability: 0.61,
      lastQcValue: 0.038,
    },
    b17: {
      balloonId: "b17",
      predictedValue: 20.028,
      confidence: 0.91,
      margin: -0.008,
      marginUnit: "mm",
      passProbability: 0.12,
      lastQcValue: null,
    },
    b1: {
      balloonId: "b1",
      predictedValue: 0.008,
      confidence: 0.9,
      margin: 0.012,
      marginUnit: "mm",
      passProbability: 0.94,
      lastQcValue: 0.007,
    },
  },
  processByBalloon: {
    b17: (() => {
      const ctx = {
        balloonId: "b17",
        feedMmMin: 1200,
        spindleRpm: 6200,
        toolId: "T06",
        mrrCm3Min: 3.6,
        estimatedDocMm: 0.25,
        estimatedWocMm: 0.4,
        vibrationRms: 2.8,
        acousticRms: 68,
        spindleLoadPct: 48,
      };
      return { ...ctx, trends: buildProcessTrends(ctx, 1, true) };
    })(),
    b3: (() => {
      const ctx = {
        balloonId: "b3",
        feedMmMin: 900,
        spindleRpm: 5800,
        toolId: "T04",
        mrrCm3Min: 2.1,
        estimatedDocMm: 0.5,
        estimatedWocMm: 3,
        vibrationRms: 1.9,
        acousticRms: 54,
        spindleLoadPct: 41,
      };
      return { ...ctx, trends: buildProcessTrends(ctx, 8, false) };
    })(),
  },
  trendsByBalloon: {},

  failurePareto: [
    { label: "Diameter Out", pct: 42, count: 42 },
    { label: "Position Error", pct: 24, count: 24 },
    { label: "Roundness Out", pct: 14, count: 14 },
    { label: "Surface Finish", pct: 11, count: 11 },
    { label: "Others", pct: 9, count: 9 },
  ],
  recommendations: [
    {
      id: "rec-1",
      action: "pull_extra_sample",
      priority: "high",
      title: "Pull an extra sample part for CMM now",
      detail:
        "B17 diameter pass probability is 12%. Sampling already covers all balloons — shorten the gap before the next automatic inspection.",
      balloonId: "b17",
    },
    {
      id: "rec-2",
      action: "verify_tool",
      priority: "recommended",
      title: "Verify tool T06 condition and runout",
      detail:
        "Finish-boring diameter risk on B17 correlates with elevated vib/acoustic on the linked operation.",
      balloonId: "b17",
    },
    {
      id: "rec-3",
      action: "increase_sampling",
      priority: "info",
      title: "Increase sampling rate for this work order",
      detail:
        "QC coverage is 6% (3/50). Raise sample frequency so high-risk balloons like B17 are confirmed sooner — each sample still measures every balloon.",
      balloonId: "b17",
    },
    {
      id: "rec-4",
      action: "continue_machining",
      priority: "ok",
      title: "Continue machining",
      detail:
        "No hold required yet — most balloons remain predicted PASS. Watch B17 until the next sample result lands.",
    },
  ],
  modelConfidence: {
    predictionConfidence: 0.91,
    similarJobsPct: 0.86,
    qcCoveragePct: 6,
    inspectedParts: 3,
    batchTotal: 50,
    modelStatus: "healthy",
    lastUpdate: "2026-04-28",
  },
  alerts: [
    {
      id: "a1",
      severity: "high_risk",
      title: "Balloon B17 (Diameter)",
      detail: "Low pass probability (12%)",
      time: "10:24",
      balloonId: "b17",
    },
    {
      id: "a2",
      severity: "warning",
      title: "Balloon B3 (Position)",
      detail: "Close to spec limit",
      time: "10:22",
      balloonId: "b3",
    },
    {
      id: "a3",
      severity: "info",
      title: "QC result received",
      detail: "Part #5 inspection logged",
      time: "10:18",
    },
  ],
};

// 20 historical prediction points + 3 QC measurements per balloon.
opsDashboardSeed.trendsByBalloon = Object.fromEntries(
  opsDashboardSeed.balloons.map((b) => {
    const end = opsDashboardSeed.predictions[b.id]?.predictedValue;
    const series = buildQualityTrend(b, end);
    // B3 position is one-sided (0 … 0.05).
    if (b.id === "b3") {
      return [
        b.id,
        series.map((p) => ({ ...p, usl: 0.05, lsl: 0 })),
      ];
    }
    return [b.id, series];
  }),
);
