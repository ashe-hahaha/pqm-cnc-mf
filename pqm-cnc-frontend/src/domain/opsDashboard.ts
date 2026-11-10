import type { CharacteristicType } from "./types";

/** Balloon risk on the operational drawing (Page 1). */
export type BalloonRisk = "pass" | "warning" | "high_risk" | "not_machined";

/** Operational actions — CMM sampling already measures all balloons on a part. */
export type OpsAction =
  | "increase_sampling"
  | "pull_extra_sample"
  | "verify_setup"
  | "continue_machining"
  | "verify_tool";

export type RecPriority = "high" | "recommended" | "info" | "ok";

export type AlertSeverity = "high_risk" | "warning" | "info";

/** Current job running on a machine — header context. */
export interface JobContext {
  machineId: string;
  machineCode: string;
  productId: string;
  productCode: string;
  workOrder: string;
  programName: string;
  currentOperation: string;
  currentTool: string;
  currentBalloonId: string | null;
  material: string;
  batchCompleted: number;
  batchTotal: number;
  inspectedParts: number;
}

export interface DrawingBalloon {
  id: string;
  code: string;
  characteristic: string;
  characteristicType: CharacteristicType;
  featureKind: string;
  nominal: number;
  upperTol: number;
  lowerTol: number;
  unit: string;
  critical: boolean;
  /** Position on drawing page, 0–100%. */
  xPct: number;
  yPct: number;
  /** 1-based PDF/image page this balloon belongs to. */
  page: number;
  /** seed = template demo; manual = user-placed on drawing. */
  source?: "seed" | "manual";
  risk: BalloonRisk;
}

export interface BalloonPrediction {
  balloonId: string;
  predictedValue: number;
  confidence: number;
  /** Signed deviation from nominal (mm or same unit). */
  margin: number;
  marginUnit: "mm" | "μm";
  passProbability: number;
  lastQcValue: number | null;
}

/** Recent samples for process-context trend charts (monitoring). */
export type ProcessTrendKey =
  | "feed"
  | "spindle"
  | "load"
  | "mrr"
  | "doc"
  | "woc"
  | "vib"
  | "acoustic";

export type ProcessTrends = Record<ProcessTrendKey, number[]>;

export interface BalloonProcessContext {
  balloonId: string;
  feedMmMin: number;
  spindleRpm: number;
  toolId: string;
  mrrCm3Min: number;
  estimatedDocMm: number;
  estimatedWocMm: number;
  vibrationRms: number;
  acousticRms: number;
  spindleLoadPct: number;
  /** Required trend series — one chart per process parameter. */
  trends: ProcessTrends;
}

export interface QualityTrendPoint {
  index: number;
  label: string;
  prediction: number;
  qcValue: number | null;
  usl: number;
  lsl: number;
}

export interface FailureParetoItem {
  label: string;
  pct: number;
  count: number;
}

export interface OpsRecommendation {
  id: string;
  action: OpsAction;
  priority: RecPriority;
  title: string;
  detail: string;
  balloonId?: string;
}

export interface ModelConfidence {
  predictionConfidence: number;
  similarJobsPct: number;
  qcCoveragePct: number;
  inspectedParts: number;
  batchTotal: number;
  modelStatus: "healthy" | "degraded";
  lastUpdate: string;
}

export interface OpsAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  time: string;
  balloonId?: string;
}

export interface OpsDashboardSnapshot {
  job: JobContext;
  balloons: DrawingBalloon[];
  predictions: Record<string, BalloonPrediction>;
  processByBalloon: Record<string, BalloonProcessContext>;
  trendsByBalloon: Record<string, QualityTrendPoint[]>;
  failurePareto: FailureParetoItem[];
  recommendations: OpsRecommendation[];
  modelConfidence: ModelConfidence;
  alerts: OpsAlert[];
  overallQuality: "good" | "watch" | "poor";
  liveAt: string;
}

export function balloonSummary(balloons: DrawingBalloon[]) {
  const pass = balloons.filter((b) => b.risk === "pass").length;
  const warning = balloons.filter((b) => b.risk === "warning").length;
  const highRisk = balloons.filter((b) => b.risk === "high_risk").length;
  const notMachined = balloons.filter((b) => b.risk === "not_machined").length;
  return {
    pass,
    warning,
    highRisk,
    notMachined,
    total: balloons.length,
  };
}
