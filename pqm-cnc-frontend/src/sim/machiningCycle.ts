import type {
  BalloonPrediction,
  BalloonProcessContext,
  BalloonRisk,
  DrawingBalloon,
  OpsAlert,
  OpsDashboardSnapshot,
  OpsRecommendation,
  QualityTrendPoint,
} from "@/domain/opsDashboard";
import {
  buildProcessTrends,
  streamProcessContext,
} from "@/lib/processTrends";
import { buildQualityTrend, QUALITY_TREND_POINTS } from "@/lib/qualityTrend";

/** One balloon finishes machining every 8s (demo pace; was 30s). */
export const BALLOON_CYCLE_MS = 8_000;

export type SimPhase = "machining" | "review";

export type FinishedOutcome = "pass" | "warning" | "high_risk";

export interface MachiningSimState {
  pieceIndex: number;
  phase: SimPhase;
  /** Machining order for the current piece. */
  order: string[];
  /** Next balloon index to finish (0 … order.length). */
  nextIndex: number;
  /** Planned outcomes — exactly 1 high_risk and 1 warning per piece. */
  outcomes: Record<string, FinishedOutcome>;
  risks: Record<string, BalloonRisk>;
  predictions: Record<string, BalloonPrediction>;
  processByBalloon: Record<string, BalloonProcessContext>;
  trendsByBalloon: Record<string, QualityTrendPoint[]>;
  phaseStartedAt: number;
  batchCompleted: number;
  /** Signature of balloon id set — reset sim when OCR set changes. */
  rosterKey: string;
}

export type SimStatus = {
  phase: SimPhase;
  pieceIndex: number;
  /** Balloon currently being machined (next to finish), or null in review. */
  activeBalloonId: string | null;
  activeBalloonCode: string | null;
  /** Last balloon that finished — used to hold process graphs in review. */
  lastFinishedBalloonId: string | null;
  lastFinishedBalloonCode: string | null;
  finishedCount: number;
  totalCount: number;
  /** Seconds remaining in current machining step (0 in review). */
  remainingSec: number;
  label: string;
  /** True when piece is complete and waiting for manual next-piece trigger. */
  canLoadNext: boolean;
};

export function rosterKeyOf(balloons: DrawingBalloon[]): string {
  return balloons
    .map((b) => b.id)
    .sort()
    .join("|");
}

export function createMachiningSim(
  balloons: DrawingBalloon[],
  batchCompleted: number,
  now = Date.now(),
): MachiningSimState {
  const order = balloons.map((b) => b.id);
  const pieceIndex = batchCompleted + 1;
  const outcomes = planOutcomes(order, pieceIndex);
  const risks = Object.fromEntries(
    order.map((id) => [id, "not_machined" as BalloonRisk]),
  );
  return {
    pieceIndex,
    phase: "machining",
    order,
    nextIndex: 0,
    outcomes,
    risks,
    predictions: {},
    processByBalloon: {},
    trendsByBalloon: {},
    phaseStartedAt: now,
    batchCompleted,
    rosterKey: rosterKeyOf(balloons),
  };
}

/** Deterministic: exactly one high_risk and one warning per piece. */
export function planOutcomes(
  order: string[],
  pieceIndex: number,
): Record<string, FinishedOutcome> {
  const out: Record<string, FinishedOutcome> = {};
  if (order.length === 0) return out;
  for (const id of order) out[id] = "pass";
  if (order.length === 1) {
    out[order[0]!] = "high_risk";
    return out;
  }
  const hi = pieceIndex % order.length;
  let warn = (pieceIndex * 5 + 2) % order.length;
  if (warn === hi) warn = (warn + 1) % order.length;
  out[order[hi]!] = "high_risk";
  out[order[warn]!] = "warning";
  return out;
}

/**
 * Advance simulation clock. Call on an interval (~250ms).
 * Returns same state reference if nothing changed.
 * Piece load is manual — see `startNextPiece`.
 */
export function tickMachiningSim(
  state: MachiningSimState,
  balloons: DrawingBalloon[],
  now = Date.now(),
  balloonMs = BALLOON_CYCLE_MS,
): MachiningSimState {
  const key = rosterKeyOf(balloons);
  if (key !== state.rosterKey || balloons.length === 0) {
    return createMachiningSim(balloons, state.batchCompleted, now);
  }

  // Hold finished piece until the operator loads the next blank.
  if (state.phase === "review") return state;

  const byId = new Map(balloons.map((b) => [b.id, b]));
  const elapsed = now - state.phaseStartedAt;

  if (state.nextIndex >= state.order.length) {
    return { ...state, phase: "review", phaseStartedAt: now };
  }

  if (elapsed < balloonMs) return state;

  // Finish one balloon
  const balloonId = state.order[state.nextIndex]!;
  const balloon = byId.get(balloonId);
  if (!balloon) {
    return { ...state, nextIndex: state.nextIndex + 1, phaseStartedAt: now };
  }

  const outcome = state.outcomes[balloonId] ?? "pass";
  const prediction = linkedPrediction(balloon, outcome, state.pieceIndex);
  const process = linkedProcess(balloon, outcome, state.pieceIndex);
  const trends = appendTrendPoint(
    state.trendsByBalloon[balloonId],
    balloon,
    prediction.predictedValue,
    state.pieceIndex,
  );

  const nextIndex = state.nextIndex + 1;
  const risks = { ...state.risks, [balloonId]: outcome };
  const predictions = { ...state.predictions, [balloonId]: prediction };
  const processByBalloon = {
    ...state.processByBalloon,
    [balloonId]: process,
  };
  const trendsByBalloon = {
    ...state.trendsByBalloon,
    [balloonId]: trends,
  };

  if (nextIndex >= state.order.length) {
    // Piece complete — keep results for review until next piece is triggered.
    return {
      ...state,
      nextIndex,
      risks,
      predictions,
      processByBalloon,
      trendsByBalloon,
      phase: "review",
      phaseStartedAt: now,
    };
  }

  return {
    ...state,
    nextIndex,
    risks,
    predictions,
    processByBalloon,
    trendsByBalloon,
    phaseStartedAt: now,
  };
}

/** Manual trigger: load next blank and start machining a new piece. */
export function startNextPiece(
  state: MachiningSimState,
  balloons: DrawingBalloon[],
  now = Date.now(),
): MachiningSimState {
  if (state.phase !== "review") return state;
  const key = rosterKeyOf(balloons);
  const nextPiece = state.pieceIndex + 1;
  const order = balloons.map((b) => b.id);
  const outcomes = planOutcomes(order, nextPiece);
  return {
    pieceIndex: nextPiece,
    phase: "machining",
    order,
    nextIndex: 0,
    outcomes,
    risks: Object.fromEntries(
      order.map((id) => [id, "not_machined" as BalloonRisk]),
    ),
    predictions: {},
    processByBalloon: {},
    trendsByBalloon: { ...state.trendsByBalloon },
    phaseStartedAt: now,
    batchCompleted: state.batchCompleted + 1,
    rosterKey: key || state.rosterKey,
  };
}

export function simStatus(
  state: MachiningSimState,
  balloons: DrawingBalloon[],
  now = Date.now(),
  balloonMs = BALLOON_CYCLE_MS,
): SimStatus {
  const byId = new Map(balloons.map((b) => [b.id, b]));
  const elapsed = now - state.phaseStartedAt;
  const lastFinishedId =
    state.nextIndex > 0 ? (state.order[state.nextIndex - 1] ?? null) : null;
  const lastFinishedCode = lastFinishedId
    ? (byId.get(lastFinishedId)?.code ?? lastFinishedId)
    : null;

  if (state.phase === "review") {
    return {
      phase: "review",
      pieceIndex: state.pieceIndex,
      activeBalloonId: null,
      activeBalloonCode: null,
      lastFinishedBalloonId: lastFinishedId,
      lastFinishedBalloonCode: lastFinishedCode,
      finishedCount: state.order.length,
      totalCount: state.order.length,
      remainingSec: 0,
      label: `Piece #${state.pieceIndex} complete · review (N = next)`,
      canLoadNext: true,
    };
  }

  const activeId = state.order[state.nextIndex] ?? null;
  const remainingSec = Math.max(0, Math.ceil((balloonMs - elapsed) / 1000));
  const code = activeId ? (byId.get(activeId)?.code ?? activeId) : null;
  return {
    phase: "machining",
    pieceIndex: state.pieceIndex,
    activeBalloonId: activeId,
    activeBalloonCode: code,
    lastFinishedBalloonId: lastFinishedId,
    lastFinishedBalloonCode: lastFinishedCode,
    finishedCount: state.nextIndex,
    totalCount: state.order.length,
    remainingSec,
    canLoadNext: false,
    label: code
      ? `Machining ${code} · ${remainingSec}s · piece #${state.pieceIndex}`
      : `Piece #${state.pieceIndex}`,
  };
}

/** Merge live sim into the seed snapshot (linked balloon data). */
export function applySimToSnapshot(
  seed: OpsDashboardSnapshot,
  state: MachiningSimState,
  templateBalloons: DrawingBalloon[],
  status: SimStatus,
  now = Date.now(),
  balloonMs = BALLOON_CYCLE_MS,
): OpsDashboardSnapshot {
  const balloons = templateBalloons.map((b) => ({
    ...b,
    risk: state.risks[b.id] ?? "not_machined",
  }));

  const predictions = { ...state.predictions };
  const processByBalloon = { ...state.processByBalloon };
  // Stream process for the balloon currently under cut; resets each new balloon.
  if (status.phase === "machining" && status.activeBalloonId) {
    const active = balloons.find((b) => b.id === status.activeBalloonId);
    if (active) {
      const outcome = state.outcomes[active.id] ?? "pass";
      const full = linkedProcess(active, outcome, state.pieceIndex);
      const progress = Math.min(
        1,
        Math.max(0, (now - state.phaseStartedAt) / Math.max(balloonMs, 1)),
      );
      processByBalloon[active.id] = streamProcessContext(full, progress);
    }
  }
  const trendsByBalloon: Record<string, QualityTrendPoint[]> = {
    ...seed.trendsByBalloon,
    ...state.trendsByBalloon,
  };

  // Ensure every balloon has a trend series (linked history).
  for (const b of balloons) {
    if (!trendsByBalloon[b.id]?.length) {
      trendsByBalloon[b.id] = buildQualityTrend(
        { ...b, risk: "pass" },
        b.nominal,
      );
    }
  }

  const finishedRisks = Object.entries(state.risks).filter(
    ([, r]) => r !== "not_machined",
  );
  const hasHigh = finishedRisks.some(([, r]) => r === "high_risk");
  const hasWarn = finishedRisks.some(([, r]) => r === "warning");

  const alerts = buildAlerts(state, balloons, status);
  const recommendations = buildRecommendations(state, balloons, status);

  return {
    ...seed,
    liveAt: new Date().toISOString(),
    overallQuality: hasHigh ? "poor" : hasWarn ? "watch" : "good",
    job: {
      ...seed.job,
      currentBalloonId:
        status.phase === "machining" ? status.activeBalloonId : null,
      currentOperation:
        status.phase === "review"
          ? "Piece review"
          : seed.job.currentOperation,
      batchCompleted: state.batchCompleted,
      batchTotal: seed.job.batchTotal,
    },
    balloons,
    predictions,
    processByBalloon,
    trendsByBalloon,
    alerts,
    recommendations,
    modelConfidence: {
      ...seed.modelConfidence,
      inspectedParts: seed.modelConfidence.inspectedParts,
      qcCoveragePct: Math.round(
        (seed.modelConfidence.inspectedParts /
          Math.max(seed.job.batchTotal, 1)) *
          100,
      ),
      predictionConfidence: hasHigh ? 0.78 : hasWarn ? 0.86 : 0.91,
    },
  };
}

function linkedPrediction(
  balloon: DrawingBalloon,
  outcome: FinishedOutcome,
  pieceIndex: number,
): BalloonPrediction {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  const wobble = span * 0.02 * Math.sin(pieceIndex + balloon.id.length);

  let predictedValue = balloon.nominal + wobble;
  let passProbability = 0.93;
  let margin = span * 0.35;

  if (outcome === "high_risk") {
    // Outside control window so detail + trend stay linked visually.
    predictedValue = usl + span * 0.14 + wobble * 0.15;
    passProbability = 0.12;
    margin = usl - predictedValue;
  } else if (outcome === "warning") {
    predictedValue = usl - span * 0.22 + wobble * 0.3;
    passProbability = 0.58;
    margin = usl - predictedValue;
  } else {
    predictedValue = balloon.nominal + span * 0.08 * Math.sin(pieceIndex);
    passProbability = 0.94;
    margin = Math.min(usl - predictedValue, predictedValue - lsl);
  }

  return {
    balloonId: balloon.id,
    predictedValue: roundEng(predictedValue, span),
    confidence: outcome === "pass" ? 0.9 : outcome === "warning" ? 0.84 : 0.91,
    margin: roundEng(margin, span),
    marginUnit: balloon.unit === "μm" ? "μm" : "mm",
    passProbability,
    lastQcValue: null,
  };
}

function linkedProcess(
  balloon: DrawingBalloon,
  outcome: FinishedOutcome,
  pieceIndex: number,
): BalloonProcessContext {
  const rising = outcome !== "pass";
  const baseLoad = outcome === "high_risk" ? 52 : outcome === "warning" ? 45 : 38;
  const baseVib = outcome === "high_risk" ? 2.9 : outcome === "warning" ? 2.1 : 1.3;
  const ctx = {
    balloonId: balloon.id,
    feedMmMin: 900 + (pieceIndex % 5) * 40,
    spindleRpm: 5600 + (balloon.id.length % 4) * 150,
    toolId: balloon.critical ? "T06" : "T04",
    mrrCm3Min: 2.2 + (pieceIndex % 3) * 0.3,
    estimatedDocMm: Math.max(0.2, balloon.nominal > 10 ? 0.4 : 0.25),
    estimatedWocMm: balloon.featureKind === "Hole" ? 0.5 : 3,
    vibrationRms: baseVib,
    acousticRms: outcome === "high_risk" ? 70 : outcome === "warning" ? 58 : 48,
    spindleLoadPct: baseLoad,
  };
  return {
    ...ctx,
    trends: buildProcessTrends(ctx, pieceIndex + balloon.id.length, rising),
  };
}

function appendTrendPoint(
  existing: QualityTrendPoint[] | undefined,
  balloon: DrawingBalloon,
  predictedValue: number,
  pieceIndex: number,
): QualityTrendPoint[] {
  const usl = balloon.nominal + balloon.upperTol;
  const lsl = balloon.nominal - balloon.lowerTol;
  const span = Math.max(usl - lsl, 1e-6);
  const prev =
    existing && existing.length > 0
      ? existing
      : buildQualityTrend({ ...balloon, risk: "pass" }, balloon.nominal);

  const next: QualityTrendPoint = {
    index: pieceIndex,
    label: String(pieceIndex),
    prediction: roundEng(predictedValue, span),
    qcValue: null,
    usl: roundEng(usl, span),
    lsl: roundEng(lsl, span),
  };
  const merged = [...prev.slice(-(QUALITY_TREND_POINTS - 1)), next].map(
    (p, i) => ({ ...p, index: i + 1, label: String(i + 1) }),
  );
  return merged;
}

function buildAlerts(
  state: MachiningSimState,
  balloons: DrawingBalloon[],
  status: SimStatus,
): OpsAlert[] {
  const byId = new Map(balloons.map((b) => [b.id, b]));
  const alerts: OpsAlert[] = [];
  const nowLabel = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (status.phase === "review") {
    alerts.push({
      id: `review-${state.pieceIndex}`,
      severity: "info",
      title: "Piece complete — review",
      detail: `Piece #${state.pieceIndex} finished. Press N or Next to load the next blank.`,
      time: nowLabel,
    });
  }

  for (const [id, risk] of Object.entries(state.risks)) {
    if (risk !== "high_risk" && risk !== "warning") continue;
    const b = byId.get(id);
    if (!b) continue;
    const pred = state.predictions[id];
    alerts.push({
      id: `a-${state.pieceIndex}-${id}`,
      severity: risk,
      title: `Balloon ${b.code} (${b.characteristic})`,
      detail:
        risk === "high_risk"
          ? `Low pass probability (${Math.round((pred?.passProbability ?? 0.12) * 100)}%)`
          : "Close to spec limit",
      time: nowLabel,
      balloonId: id,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "ok",
      severity: "info",
      title: "Machining in progress",
      detail: status.label,
      time: nowLabel,
    });
  }

  return alerts.slice(0, 5);
}

function buildRecommendations(
  state: MachiningSimState,
  balloons: DrawingBalloon[],
  status: SimStatus,
): OpsRecommendation[] {
  const byId = new Map(balloons.map((b) => [b.id, b]));
  const recs: OpsRecommendation[] = [];

  const highId = Object.entries(state.risks).find(
    ([, r]) => r === "high_risk",
  )?.[0];
  const warnId = Object.entries(state.risks).find(
    ([, r]) => r === "warning",
  )?.[0];

  if (highId) {
    const b = byId.get(highId);
    recs.push({
      id: "rec-high",
      action: "pull_extra_sample",
      priority: "high",
      title: `Pull an extra sample — ${b?.code ?? highId} high risk`,
      detail: `${b?.characteristic ?? "Feature"} pass probability is low on piece #${state.pieceIndex}.`,
      balloonId: highId,
    });
    recs.push({
      id: "rec-tool",
      action: "verify_tool",
      priority: "recommended",
      title: "Verify tool condition and runout",
      detail: "High-risk CTQ correlates with elevated vib/load on the linked operation.",
      balloonId: highId,
    });
  }

  if (warnId) {
    const b = byId.get(warnId);
    recs.push({
      id: "rec-warn",
      action: "increase_sampling",
      priority: "info",
      title: `Watch ${b?.code ?? warnId} — near limit`,
      detail: "Warning balloon is close to USL/LSL; confirm on next CMM sample.",
      balloonId: warnId,
    });
  }

  if (status.phase === "review") {
    recs.push({
      id: "rec-next",
      action: "continue_machining",
      priority: "ok",
      title: "Load next piece when ready",
      detail: "Review results, then press N or click Next to start the next blank.",
    });
  } else if (!highId) {
    recs.push({
      id: "rec-ok",
      action: "continue_machining",
      priority: "ok",
      title: "Continue machining",
      detail: status.label,
    });
  }

  return recs;
}

function roundEng(v: number, span: number): number {
  if (span >= 1) return Math.round(v * 100) / 100;
  if (span >= 0.1) return Math.round(v * 1000) / 1000;
  return Math.round(v * 10000) / 10000;
}
