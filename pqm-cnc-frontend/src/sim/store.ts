/**
 * Mutable Phase D simulation store.
 * Machine-level in-process predictions from drivers + process context.
 */

import { buildInProcessPrediction } from "@/domain/inference";
import type {
  InProcessPrediction,
  ProcessContext,
  SignalSummary,
} from "@/domain/types";

export type SimDriver = {
  machineId: string;
  toolWearRatio: number;
  thermalDriftRatio: number;
  chatterIndex: number;
  lastCpk: number;
};

type SimMachineProcess = {
  context: ProcessContext;
  signals: SignalSummary;
  currentOpLabel: string;
};

const drivers = new Map<string, SimDriver>([
  [
    "mch-mill-03",
    {
      machineId: "mch-mill-03",
      toolWearRatio: 0.55,
      thermalDriftRatio: 0.3,
      chatterIndex: 0.1,
      lastCpk: 1.4,
    },
  ],
  [
    "mch-mill-01",
    {
      machineId: "mch-mill-01",
      toolWearRatio: 0.8,
      thermalDriftRatio: 0.55,
      chatterIndex: 0.35,
      lastCpk: 0.95,
    },
  ],
  [
    "mch-turn-02",
    {
      machineId: "mch-turn-02",
      toolWearRatio: 0.4,
      thermalDriftRatio: 0.2,
      chatterIndex: 0.05,
      lastCpk: 1.5,
    },
  ],
]);

const processes = new Map<string, SimMachineProcess>([
  [
    "mch-mill-03",
    {
      currentOpLabel: "Finish bore OD",
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
    },
  ],
  [
    "mch-mill-01",
    {
      currentOpLabel: "Rough pocket",
      context: {
        feedMmMin: 1800,
        spindleRpm: 7200,
        toolCode: "T04",
        toolGeometry: "Ø16 endmill 3F",
        widthOfCutMm: 12,
        depthOfCutMm: 2.5,
        material: "Al 6061",
        axisLoadPct: 88,
      },
      signals: {
        vibrationRms: 0.91,
        vibrationBandHz: "1.2–3k",
        acousticRms: 0.64,
        acousticBandKHz: "8–14",
      },
    },
  ],
  [
    "mch-turn-02",
    {
      currentOpLabel: "Journal OD finish",
      context: {
        feedMmMin: 0.12,
        spindleRpm: 2200,
        toolCode: "T02",
        toolGeometry: "CNMG insert R0.4",
        widthOfCutMm: 0.4,
        depthOfCutMm: 0.25,
        material: "Steel 4140",
        axisLoadPct: 48,
      },
      signals: {
        vibrationRms: 0.28,
        vibrationBandHz: "400–1k",
        acousticRms: 0.12,
        acousticBandKHz: "6–10",
      },
    },
  ],
]);

export function getDriver(machineId: string): SimDriver | undefined {
  return drivers.get(machineId);
}

export function listDrivers(): SimDriver[] {
  return [...drivers.values()];
}

export function getLivePrediction(
  machineId: string,
  ts?: string,
): InProcessPrediction | undefined {
  const driver = drivers.get(machineId);
  const process = processes.get(machineId);
  if (!driver || !process) return undefined;

  return buildInProcessPrediction({
    machineId,
    ts,
    drivers: {
      toolWearRatio: driver.toolWearRatio,
      thermalDriftRatio: driver.thermalDriftRatio,
      chatterIndex: driver.chatterIndex,
      lastCpk: driver.lastCpk,
      axisLoadPct: process.context.axisLoadPct,
    },
    context: process.context,
    signals: process.signals,
    currentOpLabel: process.currentOpLabel,
  });
}

export function listLivePredictions(ts?: string): InProcessPrediction[] {
  return [...drivers.keys()]
    .map((id) => getLivePrediction(id, ts))
    .filter((p): p is InProcessPrediction => p != null);
}
