/**
 * Machine-level in-process quality scoring (Phase D heuristic).
 * Phase P swaps inputs for real model outputs; keep field contract stable.
 */

import type {
  InProcessLabel,
  InProcessPrediction,
  PredictionDriver,
  ProcessContext,
  SignalSummary,
} from "./types";

export const MODEL_VERSION_SIM = "sim-heuristic-v0";

export type InferenceDrivers = {
  toolWearRatio: number;
  thermalDriftRatio: number;
  chatterIndex: number;
  lastCpk: number;
  axisLoadPct: number;
};

/** Map quality score → traffic label (higher Q = healthier). */
export function labelFromQualityScore(score: number): InProcessLabel {
  if (score >= 80) return "ok";
  if (score >= 65) return "watch";
  if (score >= 45) return "suspect";
  return "critical";
}

/**
 * Heuristic machine quality score 0–100 from process risk drivers.
 * Golden tests lock demo numbers for seed machines.
 */
export function qualityScoreFromDrivers(input: InferenceDrivers): number {
  const wear = clamp01(input.toolWearRatio) * 25;
  const thermal = clamp01(input.thermalDriftRatio) * 20;
  const chatter = clamp01(input.chatterIndex) * 40;
  const load = clamp01(input.axisLoadPct / 100) * 10;
  const cpkPenalty =
    input.lastCpk >= 1.33 ? 0 : input.lastCpk >= 1.0 ? 8 : 18;
  const penalty = wear + thermal + chatter + load + cpkPenalty;
  return round1(clamp(100 - penalty, 0, 100));
}

export function defectProbFromScore(qualityScore: number): number {
  return round2(clamp((100 - qualityScore) / 100, 0, 1));
}

export function confidenceFromDrivers(input: InferenceDrivers): number {
  // Stronger abnormal signals → slightly higher confidence in Phase D sim.
  const signal =
    clamp01(input.chatterIndex) * 0.08 +
    clamp01(input.toolWearRatio) * 0.04;
  return round2(clamp(0.78 + signal, 0.7, 0.95));
}

export function topDriversFromInput(
  input: InferenceDrivers,
): PredictionDriver[] {
  const candidates: PredictionDriver[] = [
    {
      name: "tool wear",
      direction: "up",
      weight: clamp01(input.toolWearRatio),
    },
    {
      name: "thermal drift",
      direction: "up",
      weight: clamp01(input.thermalDriftRatio),
    },
    {
      name: "acoustic / chatter",
      direction: "up",
      weight: clamp01(input.chatterIndex),
    },
    {
      name: "axis load",
      direction: "up",
      weight: clamp01(input.axisLoadPct / 100),
    },
  ];
  return candidates
    .filter((d) => d.weight >= 0.25)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((d) => ({ ...d, weight: round2(d.weight) }));
}

export function buildInProcessPrediction(input: {
  machineId: string;
  ts?: string;
  drivers: InferenceDrivers;
  context: ProcessContext;
  signals: SignalSummary;
  currentOpLabel?: string;
  modelVersion?: string;
}): InProcessPrediction {
  const qualityScore = qualityScoreFromDrivers(input.drivers);
  return {
    machineId: input.machineId,
    ts: input.ts ?? new Date().toISOString(),
    qualityScore,
    defectProb: defectProbFromScore(qualityScore),
    confidence: confidenceFromDrivers(input.drivers),
    label: labelFromQualityScore(qualityScore),
    topDrivers: topDriversFromInput(input.drivers),
    context: input.context,
    signals: input.signals,
    currentOpLabel: input.currentOpLabel,
    modelVersion: input.modelVersion ?? MODEL_VERSION_SIM,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
