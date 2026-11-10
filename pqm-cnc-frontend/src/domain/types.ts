export type Role =
  | "operator"
  | "supervisor"
  | "quality_engineer"
  | "planner"
  | "manager"
  | "administrator";

export type AssetLevel =
  | "enterprise"
  | "plant"
  | "cell"
  | "line"
  | "machine"
  | "metrology";

export type MachineState =
  | "RUNNING"
  | "IDLE"
  | "SETUP"
  | "TOOL_CHANGE"
  | "MAINTENANCE"
  | "HOLD_QUALITY"
  | "OFFLINE"
  | "UNKNOWN";

export type CharacteristicType =
  | "OD"
  | "ID"
  | "LENGTH"
  | "FLATNESS"
  | "ROUNDNESS"
  | "SURFACE_RA"
  | "POSITION"
  | "OTHER";

export type DefectCategory =
  | "dimensional"
  | "surface"
  | "geometric"
  | "other";

export interface AssetNode {
  id: string;
  code: string;
  name: string;
  level: AssetLevel;
  parentId: string | null;
  active: boolean;
}

export interface PartFamily {
  id: string;
  code: string;
  name: string;
  industry: string;
}

export interface Characteristic {
  id: string;
  partFamilyId: string;
  code: string;
  name: string;
  type: CharacteristicType;
  nominal: number;
  upperTol: number;
  lowerTol: number;
  unit: string;
  critical: boolean;
}

export interface MeasurementPlan {
  id: string;
  partFamilyId: string;
  name: string;
  characteristicIds: string[];
}

export interface QualityFacts {
  machineId: string;
  windowStart: string;
  windowEnd: string;
  sampleCount: number;
  scrapCount: number;
  reworkCount: number;
  predictedScrapPct: number;
  avgCpk: number;
  maxDeviationRatio: number;
  openHolds: number;
}

export interface QualityResult {
  assetId: string;
  predictedScrapPct: number;
  avgCpk: number;
  maxDeviationRatio: number;
  openHolds: number;
  scrapPct: number;
  health: "green" | "gold" | "red";
}

export interface SpcPoint {
  ts: string;
  characteristicId: string;
  machineId: string;
  value: number;
  ucl: number;
  lcl: number;
  mean: number;
  outOfControl: boolean;
}

export interface DefectEvent {
  id: string;
  machineId: string;
  characteristicId?: string;
  category: DefectCategory;
  reasonCode: string;
  reasonLabel: string;
  start: string;
  end: string | null;
  count: number;
  predicted: boolean;
  source: "metrology" | "in_process" | "operator" | "sim";
}

export interface QualityAlert {
  id: string;
  machineId: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  characteristicId?: string;
  createdAt: string;
  acknowledged: boolean;
}

export interface DemoUser {
  id: string;
  name: string;
  role: Role;
}

export interface YieldScenarioInput {
  machineId: string;
  action: "early_tool_change" | "feed_override" | "run_to_fail";
  horizonHours: number;
}

export interface YieldScenarioResult {
  id: string;
  input: YieldScenarioInput;
  baselineScrapPct: number;
  projectedScrapPct: number;
  yieldDeltaPct: number;
  notes: string;
}

/** Traffic label for machine-level in-process AI quality. */
export type InProcessLabel = "ok" | "watch" | "suspect" | "critical";

/** Process context fed to the quality model (machine grain). */
export interface ProcessContext {
  feedMmMin: number;
  spindleRpm: number;
  toolCode: string;
  toolGeometry: string;
  widthOfCutMm: number;
  depthOfCutMm: number;
  material: string;
  axisLoadPct: number;
}

/** Compact signal summaries — not raw waveforms. */
export interface SignalSummary {
  vibrationRms: number;
  vibrationBandHz: string;
  acousticRms: number;
  acousticBandKHz: string;
}

export interface PredictionDriver {
  name: string;
  direction: "up" | "down";
  weight: number;
}

/**
 * Machine-level in-process quality prediction.
 * Phase D: sim heuristic. Phase P: edge/FastAPI model behind same shape.
 */
export interface InProcessPrediction {
  machineId: string;
  ts: string;
  qualityScore: number;
  defectProb: number;
  confidence: number;
  label: InProcessLabel;
  topDrivers: PredictionDriver[];
  context: ProcessContext;
  signals: SignalSummary;
  currentOpLabel?: string;
  modelVersion: string;
}
