import {
  balloonSummary,
  type BalloonPrediction,
  type BalloonRisk,
  type DrawingBalloon,
  type QualityTrendPoint,
} from "@/domain/opsDashboard";
import { linkBalloonDetailAndTrend } from "@/lib/qualityTrend";
import { queryAllLiveInference } from "@/lib/queries/inference";
import { queryOpsDashboard } from "@/lib/queries/opsDashboard";
import { assets } from "@/seed/plant";
import { classifyIntent, extractEntities } from "./nlu";
import type {
  CopilotAction,
  CopilotContext,
  CopilotEntities,
  CopilotIntent,
  CopilotReply,
} from "./types";

export type { CopilotAction, CopilotContext, CopilotReply } from "./types";

export const DEFAULT_CHIPS = [
  "How is quality looking?",
  "Which balloons are high risk?",
  "Why is the selected balloon risky?",
  "Show quality trend",
  "What should I do next?",
  "Load next piece?",
];

function reply(
  intent: CopilotIntent,
  confidence: number,
  entities: CopilotEntities,
  message: string,
  actions: CopilotAction[] = [],
  chips: string[] = DEFAULT_CHIPS,
): CopilotReply {
  return { intent, confidence, entities, message, actions, chips };
}

function enrichFromSeed(ctx?: CopilotContext): CopilotContext {
  if (ctx?.summary) return ctx;
  const seed = queryOpsDashboard();
  const summary = balloonSummary(seed.balloons);
  return {
    ...ctx,
    summary: {
      pass: summary.pass,
      warning: summary.warning,
      highRisk: summary.highRisk,
      notMachined: summary.notMachined,
      total: summary.total,
    },
    highRiskCodes: seed.balloons
      .filter((b) => b.risk === "high_risk")
      .map((b) => b.code),
    warningCodes: seed.balloons
      .filter((b) => b.risk === "warning")
      .map((b) => b.code),
    alerts: seed.alerts.map((a) => ({
      title: a.title,
      detail: a.detail,
      balloonId: a.balloonId,
    })),
    recommendations: seed.recommendations.map((r) => ({
      title: r.title,
      detail: r.detail,
      priority: r.priority,
      balloonId: r.balloonId,
    })),
    selectedBalloonId: ctx?.selectedBalloonId ?? seed.job.currentBalloonId,
    selectedBalloonCode:
      ctx?.selectedBalloonCode ??
      seed.balloons.find((b) => b.id === seed.job.currentBalloonId)?.code ??
      null,
  };
}

function help(entities: CopilotEntities): CopilotReply {
  return reply(
    "help",
    1,
    entities,
    "I’m the **PQM Copilot** for CNC predictive quality. Ask about balloon risk, quality overview, trends (predicted vs measured), AI recommendations, process context, or sim status. I’ll answer from live ops data and deep-link the dashboard.",
    [
      { label: "Drawing map", href: "/dashboard#drawing" },
      { label: "Alerts", href: "/dashboard#alerts" },
      { label: "Trends", href: "/dashboard#trend" },
    ],
  );
}

function greet(entities: CopilotEntities): CopilotReply {
  return reply(
    "greet",
    1,
    entities,
    "Hi — I can walk the predictive quality story with you. Try asking about high-risk balloons, the selected balloon, or what to do next.",
    [{ label: "Open dashboard", href: "/dashboard" }],
  );
}

function qualityOverview(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  const s = ctx.summary!;
  const lines = [
    `**Balloon quality** — ${s.total} balloons on this piece: **${s.pass}** pass · **${s.warning}** warning · **${s.highRisk}** high risk · **${s.notMachined}** not machined.`,
  ];
  if (ctx.highRiskCodes?.length) {
    lines.push(`High risk: ${ctx.highRiskCodes.join(", ")}.`);
  }
  if (ctx.warningCodes?.length) {
    lines.push(`Warning: ${ctx.warningCodes.join(", ")}.`);
  }
  if (ctx.simLabel) lines.push(`Sim: ${ctx.simLabel}`);
  return reply(
    "quality_overview",
    0.95,
    entities,
    lines.join("\n"),
    [
      { label: "Drawing map", href: "/dashboard#drawing" },
      { label: "Alerts", href: "/dashboard#alerts" },
    ],
  );
}

function listHighRisk(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  const codes = ctx.highRiskCodes ?? [];
  const message = codes.length
    ? `**High-risk balloons:** ${codes.join(", ")}. Focus them on the drawing and review predictions + measured QC on the trend.`
    : "No high-risk balloons on the current piece — quality looks clear on CTQs.";
  return reply(
    "list_high_risk",
    0.95,
    entities,
    message,
    [
      { label: "Drawing map", href: "/dashboard#drawing" },
      { label: "Alerts", href: "/dashboard#alerts" },
    ],
    ["Why is the selected balloon risky?", "What should I do next?", "Show quality trend"],
  );
}

function listWarning(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  const codes = ctx.warningCodes ?? [];
  const message = codes.length
    ? `**Warning balloons (near limit):** ${codes.join(", ")}. Watch pass probability and confirm on the next CMM sample.`
    : "No warning balloons right now.";
  return reply("list_warning", 0.93, entities, message, [
    { label: "Drawing map", href: "/dashboard#drawing" },
    { label: "Trends", href: "/dashboard#trend" },
  ]);
}

const BALLOON_ACTIONS: CopilotAction[] = [
  { label: "Balloon detail", href: "/dashboard#detail" },
  { label: "Quality trend", href: "/dashboard#trend" },
  { label: "Process context", href: "/dashboard#process" },
  { label: "Drawing", href: "/dashboard#drawing" },
];

/** Risk we can state for a balloon: live bands, or "unflagged" (not high/warning). */
type KnownRisk = BalloonRisk | "unflagged";

type ResolvedBalloon = {
  balloon: DrawingBalloon;
  risk: KnownRisk;
  /** true = this is the selected balloon, so risk/prediction are live values. */
  live: boolean;
  prediction: BalloonPrediction | null;
  trend: QualityTrendPoint[];
};

const RISK_BANDS: BalloonRisk[] = ["pass", "warning", "high_risk", "not_machined"];

/** Normalise "b17" / "17" / "B 17" / "balloon 17" to "B17" (null when no number). */
function normalizeBalloonCode(raw?: string | null): string | null {
  const m = raw?.match(/(\d+)/);
  return m ? `B${Number(m[1])}` : null;
}

function validBalloonCodes(ctx: CopilotContext): string[] {
  const codes = new Set(queryOpsDashboard().balloons.map((b) => b.code));
  for (const c of ctx.highRiskCodes ?? []) codes.add(c);
  for (const c of ctx.warningCodes ?? []) codes.add(c);
  if (ctx.selectedBalloonCode) codes.add(ctx.selectedBalloonCode);
  return [...codes].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function unknownBalloon(
  entities: CopilotEntities,
  ctx: CopilotContext,
  requested: string,
  intent: CopilotIntent = "explain_balloon",
): CopilotReply {
  return reply(
    intent,
    0.3,
    entities,
    `There is no balloon ${requested} on this drawing. Valid balloons: ${validBalloonCodes(ctx).join(", ")}.`,
    [{ label: "Drawing", href: "/dashboard#drawing" }],
  );
}

/**
 * Resolve a balloon by code. Static facts come from the seed; risk comes from
 * the client-sent context (live) — never from the *selected* balloon unless
 * the code actually is the selected one.
 */
function resolveBalloon(code: string, ctx: CopilotContext): ResolvedBalloon | null {
  const seed = queryOpsDashboard();
  let balloon = seed.balloons.find((b) => b.code === code);
  const seedBalloon = balloon != null;
  const isSelected = ctx.selectedBalloonCode === code;
  const flagged = (list?: string[]) => list?.includes(code) ?? false;
  if (!balloon) {
    // A client-only (manual) balloon: we only know what the live lists say.
    if (!isSelected && !flagged(ctx.highRiskCodes) && !flagged(ctx.warningCodes)) {
      return null;
    }
    balloon = {
      id: code.toLowerCase(),
      code,
      characteristic: ctx.selectedCharacteristic ?? "manual balloon",
      characteristicType: "LENGTH",
      featureKind: "Manual",
      nominal: 0,
      upperTol: 0,
      lowerTol: 0,
      unit: "mm",
      critical: false,
      xPct: 0,
      yPct: 0,
      page: 1,
      risk: "pass",
    };
  }

  let risk: KnownRisk;
  const selRisk = ctx.selectedRisk as BalloonRisk | null | undefined;
  if (isSelected && selRisk && RISK_BANDS.includes(selRisk)) risk = selRisk;
  else if (flagged(ctx.highRiskCodes)) risk = "high_risk";
  else if (flagged(ctx.warningCodes)) risk = "warning";
  else if (isSelected || !seedBalloon) risk = "unflagged";
  else risk = balloon.risk === "not_machined" ? "not_machined" : "unflagged";

  let prediction: BalloonPrediction | null = seed.predictions[balloon.id] ?? null;
  if (isSelected && ctx.predictedValue != null) {
    prediction = {
      ...(prediction ?? {
        balloonId: balloon.id,
        confidence: 0.9,
        margin: 0,
        marginUnit: balloon.unit === "μm" ? "μm" : "mm",
        lastQcValue: null,
      }),
      predictedValue: ctx.predictedValue,
      passProbability: ctx.passProbability ?? prediction?.passProbability ?? 0,
    };
  } else if (!isSelected && prediction) {
    // The seed prediction only describes the seed risk band; don't present it
    // for a balloon whose live band differs.
    const liveBand = risk === "unflagged" ? "pass" : risk;
    if (balloon.risk !== liveBand) prediction = null;
  }
  if (risk === "not_machined") prediction = null;

  const trendRisk: BalloonRisk = risk === "unflagged" ? "pass" : risk;
  const linked = linkBalloonDetailAndTrend(
    { ...balloon, risk: trendRisk },
    prediction,
    seed.trendsByBalloon[balloon.id],
  );
  return {
    balloon,
    risk,
    live: isSelected,
    // Only the selected balloon has a live prediction; others keep the seed one (or none).
    prediction: isSelected ? (linked.prediction ?? prediction) : prediction,
    trend: linked.trend,
  };
}

function fmtNum(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function toleranceText(b: DrawingBalloon): string {
  const lsl = fmtNum(b.nominal - b.lowerTol);
  const usl = fmtNum(b.nominal + b.upperTol);
  const tol =
    b.upperTol === b.lowerTol
      ? `±${fmtNum(b.upperTol)}`
      : `+${fmtNum(b.upperTol)}/-${fmtNum(b.lowerTol)}`;
  return `nominal ${fmtNum(b.nominal)} ${tol} ${b.unit} (limits ${lsl}–${usl})`;
}

function riskLabel(risk: KnownRisk): string {
  return risk === "unflagged"
    ? "not flagged as high risk or warning (pass, or not yet machined)"
    : risk.replace("_", " ");
}

/** Which balloon a question is about: named code, else selected, else first high risk. */
function pickCode(
  entities: CopilotEntities,
  ctx: CopilotContext,
  requested?: string,
): string | null {
  return (
    entities.balloonCode ??
    normalizeBalloonCode(requested) ??
    ctx.selectedBalloonCode ??
    ctx.highRiskCodes?.[0] ??
    null
  );
}

function explainBalloon(
  entities: CopilotEntities,
  ctx: CopilotContext,
  requested?: string,
): CopilotReply {
  const wanted = requested?.trim();
  if (wanted && !entities.balloonCode && !normalizeBalloonCode(wanted)) {
    return unknownBalloon(entities, ctx, wanted);
  }
  const code = pickCode(entities, ctx, wanted);
  if (!code) {
    return reply(
      "explain_balloon",
      0.4,
      entities,
      `No balloon is selected. Name one (valid balloons: ${validBalloonCodes(ctx).join(", ")}) or click a balloon on the drawing.`,
      [{ label: "Drawing", href: "/dashboard#drawing" }],
    );
  }
  const r = resolveBalloon(code, ctx);
  if (!r) return unknownBalloon({ ...entities, balloonCode: code }, ctx, code);

  const { balloon, risk, prediction } = r;
  const ents: CopilotEntities = { ...entities, balloonCode: code, balloonId: balloon.id };
  const lines = [
    `**${code}** (${balloon.characteristic}, ${balloon.featureKind}${balloon.critical ? ", critical" : ""}) — ${r.live ? "current risk" : "risk"} **${riskLabel(risk)}**.`,
  ];
  if (balloon.nominal || balloon.upperTol || balloon.lowerTol) {
    lines.push(`Spec: ${toleranceText(balloon)}.`);
  }
  if (prediction) {
    lines.push(
      `${r.live ? "Predicted value" : "Seed-snapshot predicted value"}: **${fmtNum(prediction.predictedValue)}** ${balloon.unit}; pass probability **${Math.round(prediction.passProbability * 100)}%**.`,
    );
  }
  const proc = queryOpsDashboard().processByBalloon[balloon.id];
  if (proc) {
    lines.push(
      `Process: ${proc.feedMmMin} mm/min feed, ${proc.spindleRpm} rpm, tool ${proc.toolId}.`,
    );
  }
  if (risk === "high_risk") {
    lines.push(
      "The latest prediction is outside the control window — compare it with the measured QC points on the quality trend.",
    );
  } else if (risk === "warning") {
    lines.push("Close to the limit — confirm on the next CMM sample.");
  } else if (risk === "not_machined") {
    lines.push(
      "Not machined yet on this piece — the prediction appears when the balloon finishes in the sim.",
    );
  }
  if (!r.live) {
    lines.push(
      "Note: only static drawing data and the dashboard's risk lists are available for this balloon; the live prediction is shown when it is selected on the dashboard.",
    );
  }
  return reply("explain_balloon", 0.92, ents, lines.join("\n"), BALLOON_ACTIONS);
}

function nextActions(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  const recs = ctx.recommendations ?? [];
  if (!recs.length) {
    return reply(
      "next_actions",
      0.8,
      entities,
      "No AI recommendations right now. If the piece is in review, load the next blank with **N** when ready.",
      [{ label: "Recommendations panel", href: "/dashboard#recommendations" }],
    );
  }
  const top = recs.slice(0, 3);
  const lines = [
    "**Suggested next actions:**",
    ...top.map(
      (r, i) =>
        `${i + 1}. **${r.title}** (${r.priority}) — ${r.detail}`,
    ),
  ];
  return reply("next_actions", 0.94, entities, lines.join("\n"), [
    { label: "AI recommendations", href: "/dashboard#recommendations" },
    { label: "Alerts", href: "/dashboard#alerts" },
  ]);
}

function simStatus(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  if (ctx.simPhase === "review" || ctx.canLoadNext) {
    return reply(
      "sim_status",
      0.95,
      entities,
      `**Piece complete — review mode.** ${ctx.simLabel ?? ""}\nResults stay on screen for demo. Press **N** or click **Next** in the header to load the next blank.`,
      [{ label: "Open dashboard", href: "/dashboard" }],
      ["Load next piece?", "How is quality looking?", "What should I do next?"],
    );
  }
  return reply(
    "sim_status",
    0.9,
    entities,
    `**Machining in progress.** ${ctx.simLabel ?? "Live cycle running."}\nBalloons finish every 8s (or faster at 10×). When the piece completes you’ll enter review.`,
    [{ label: "Drawing map", href: "/dashboard#drawing" }],
  );
}

function nextPiece(
  entities: CopilotEntities,
  ctx: CopilotContext,
): CopilotReply {
  if (ctx.canLoadNext || ctx.simPhase === "review") {
    return reply(
      "next_piece",
      0.96,
      entities,
      "Ready for the next blank. Click the small **Next N** button in the header, or press **N** (when not typing in an input).",
      [{ label: "Back to dashboard", href: "/dashboard" }],
    );
  }
  return reply(
    "next_piece",
    0.9,
    entities,
    "Next piece is locked until the current piece finishes machining and enters **review**. Watch the sim label in the header.",
    [{ label: "Drawing map", href: "/dashboard#drawing" }],
    ["How is quality looking?", "Sim status"],
  );
}

function openPanel(
  intent: CopilotIntent,
  entities: CopilotEntities,
  label: string,
  href: string,
  tip: string,
): CopilotReply {
  return reply(intent, 0.95, entities, tip, [{ label, href }]);
}

function qualityTrend(
  entities: CopilotEntities,
  ctx: CopilotContext,
  requested?: string,
): CopilotReply {
  const wanted = requested?.trim();
  if (wanted && !entities.balloonCode && !normalizeBalloonCode(wanted)) {
    return unknownBalloon(entities, ctx, wanted, "quality_trend");
  }
  const code = pickCode(entities, ctx, wanted);
  const r = code ? resolveBalloon(code, ctx) : null;
  if (!code || !r) {
    return code
      ? unknownBalloon({ ...entities, balloonCode: code }, ctx, code, "quality_trend")
      : reply(
          "quality_trend",
          0.4,
          entities,
          `No balloon is selected. Name one (valid balloons: ${validBalloonCodes(ctx).join(", ")}) to read its trend.`,
          [{ label: "Quality trend", href: "/dashboard#trend" }],
        );
  }
  const pts = r.trend;
  const last = pts[pts.length - 1]!;
  const qc = pts.filter((p) => p.qcValue != null);
  const lastQc = qc[qc.length - 1];
  const outside = last.prediction > last.usl || last.prediction < last.lsl;
  const lines = [
    `**Quality trend** for **${code}** (${r.balloon.characteristic}): ${pts.length} prediction points with **${qc.length} measured QC** points. Latest prediction **${fmtNum(last.prediction)}** ${r.balloon.unit} vs limits ${fmtNum(last.lsl)}–${fmtNum(last.usl)} — ${outside ? "**outside** the control window" : "inside the control window"}.`,
  ];
  if (lastQc) {
    lines.push(`Last measured QC: **${fmtNum(lastQc.qcValue!)}** ${r.balloon.unit} (point ${lastQc.index}).`);
  }
  lines.push(
    `Risk: ${riskLabel(r.risk)}.${r.live ? "" : " (The series is the demo's simulated history; live prediction only for the selected balloon.)"}`,
  );
  return reply(
    "quality_trend",
    0.93,
    { ...entities, balloonCode: code, balloonId: r.balloon.id },
    lines.join("\n"),
    [
      { label: "Open trend", href: "/dashboard#trend" },
      { label: "Drawing", href: "/dashboard#drawing" },
    ],
  );
}

function machineInference(
  entities: CopilotEntities,
  machine?: string,
): CopilotReply {
  const machines = assets.filter((a) => a.level === "machine");
  const all = queryAllLiveInference();
  const named = machine?.trim();
  const label = (id: string) => {
    const m = machines.find((x) => x.id === id);
    return m ? `${m.name} (${m.code})` : id;
  };
  const line = (p: (typeof all)[number]) => {
    const drivers = p.topDrivers
      .map((d) => `${d.name} ${d.direction === "up" ? "↑" : "↓"}`)
      .join(", ");
    return `**${label(p.machineId)}**: quality score **${p.qualityScore}** (${p.label}), defect probability **${Math.round(p.defectProb * 100)}%**, confidence ${Math.round(p.confidence * 100)}%${drivers ? `, drivers: ${drivers}` : ""}.`;
  };
  const actions = [{ label: "Dashboard", href: "/dashboard" }];
  if (named) {
    const q = named.toLowerCase();
    const m = machines.find(
      (x) =>
        x.id.toLowerCase() === q ||
        x.code.toLowerCase() === q ||
        x.name.toLowerCase().includes(q) ||
        q.includes(x.code.toLowerCase()),
    );
    const p = m ? all.find((x) => x.machineId === m.id) : undefined;
    if (!m || !p) {
      return reply(
        "machine_inference",
        0.3,
        entities,
        `No in-process quality prediction for “${named}”. Machines with predictions: ${all.map((x) => label(x.machineId)).join(", ")}.`,
        actions,
      );
    }
    return reply("machine_inference", 0.9, entities, `In-process quality (sim heuristic model): ${line(p)}`, actions);
  }
  return reply(
    "machine_inference",
    0.9,
    entities,
    ["**In-process machine quality** (sim heuristic model):", ...all.map(line)].join("\n"),
    actions,
  );
}

function fallback(entities: CopilotEntities): CopilotReply {
  return reply(
    "fallback",
    0.4,
    entities,
    "I didn’t catch that. Try quality overview, high-risk balloons, selected balloon detail, recommendations, trends, or next piece.",
    [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Drawing", href: "/dashboard#drawing" },
    ],
  );
}

type ToolArgs = { balloon?: string; machine?: string };

function runIntent(
  intent: CopilotIntent,
  entities: CopilotEntities,
  ctx: CopilotContext,
  args: ToolArgs = {},
): CopilotReply {
  switch (intent) {
    case "greet":
      return greet(entities);
    case "help":
      return help(entities);
    case "quality_overview":
      return qualityOverview(entities, ctx);
    case "list_high_risk":
      return listHighRisk(entities, ctx);
    case "list_warning":
      return listWarning(entities, ctx);
    case "explain_balloon":
      return explainBalloon(entities, ctx, args.balloon);
    case "next_actions":
      return nextActions(entities, ctx);
    case "sim_status":
      return simStatus(entities, ctx);
    case "next_piece":
      return nextPiece(entities, ctx);
    case "quality_trend":
      return qualityTrend(entities, ctx, args.balloon);
    case "machine_inference":
      return machineInference(entities, args.machine);
    case "open_drawing":
      return openPanel(
        intent,
        entities,
        "Open drawing",
        "/dashboard#drawing",
        "Opening the **Quality Balloon Map** — select balloons to inspect detail and trend.",
      );
    case "open_trends":
      return openPanel(
        intent,
        entities,
        "Open trends",
        "/dashboard#trend",
        "Opening **Quality trend** — predicted series with measured QC reference points.",
      );
    case "open_alerts":
      return openPanel(
        intent,
        entities,
        "Open alerts",
        "/dashboard#alerts",
        "Opening the **Alerts** panel for live risk callouts.",
      );
    case "open_process":
      return openPanel(
        intent,
        entities,
        "Open process",
        "/dashboard#process",
        "Opening **Process context** for the balloon currently machining.",
      );
    case "open_recommendations":
      return openPanel(
        intent,
        entities,
        "Open recommendations",
        "/dashboard#recommendations",
        "Check the **AI recommendations** list on the left — click a row for detail.",
      );
    default:
      return fallback(entities);
  }
}

/** Scripted PQM copilot — grounded in live client context (+ seed fallback). */
export function runCopilot(
  message: string,
  context?: CopilotContext,
): CopilotReply {
  const entities = extractEntities(message);
  const { intent, confidence } = classifyIntent(message, entities);
  void confidence;
  const ctx = enrichFromSeed(context);

  // If user named a balloon, prefer explain when intent is weak overview.
  if (
    entities.balloonCode &&
    (intent === "fallback" || intent === "quality_overview")
  ) {
    return explainBalloon(entities, ctx);
  }
  return runIntent(intent, entities, ctx);
}

/** LLM tool entry point: run an intent with explicit args (balloon code / machine). */
export function runCopilotTool(
  intent: CopilotIntent,
  args: ToolArgs,
  context?: CopilotContext,
): CopilotReply {
  const entities = extractEntities(args.balloon ?? "");
  return runIntent(intent, entities, enrichFromSeed(context), args);
}
