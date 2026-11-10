import {
  streamAgent,
  type AgentTool,
  type ChatTurn,
  type StreamEvent,
} from "copilot-kit/server";
import { DEFAULT_CHIPS, runCopilot, runCopilotTool } from "./tools";
import type { CopilotContext, CopilotIntent } from "./types";

export type { ChatTurn };
export type CopilotStreamEvent = StreamEvent;

const BALLOON_PARAM = {
  type: "string",
  description:
    "Balloon code such as 'B17' or 'B3'. Omit to use the balloon selected on the dashboard.",
};

type ToolDef = {
  intent: CopilotIntent;
  description: string;
  params?: Record<string, unknown>;
};

const TOOL_DEFS: Record<string, ToolDef> = {
  quality_overview: {
    intent: "quality_overview",
    description:
      "Overall quality of the current piece: counts of pass / warning / high-risk / not-machined balloons and which codes are flagged. Use for 'how is quality looking' type questions.",
  },
  list_high_risk_balloons: {
    intent: "list_high_risk",
    description:
      "List the balloons (drawing characteristics) currently predicted HIGH RISK of being out of tolerance / scrap risk.",
  },
  list_warning_balloons: {
    intent: "list_warning",
    description:
      "List the balloons currently in WARNING (near the tolerance limit but not yet high risk).",
  },
  explain_balloon: {
    intent: "explain_balloon",
    description:
      "Explain ONE specific balloon: characteristic, nominal/tolerance, risk band, predicted value and pass probability, process settings. Use when the user names a balloon code (e.g. B17) or asks about 'the selected balloon' / 'why is it risky'. Does not give the trend series.",
    params: { balloon: BALLOON_PARAM },
  },
  quality_trend: {
    intent: "quality_trend",
    description:
      "Quality trend of one balloon: number of prediction points, measured QC points, latest predicted value vs. the LSL/USL limits. Use for 'show/explain the trend' questions.",
    params: { balloon: BALLOON_PARAM },
  },
  next_actions: {
    intent: "next_actions",
    description:
      "The AI recommendations list: what the operator or quality engineer should do next (extra samples, verify setup, verify tool...).",
  },
  sim_status: {
    intent: "sim_status",
    description:
      "Status of the machining simulation: machining in progress or piece complete (review), and the sim label.",
  },
  next_piece_advice: {
    intent: "next_piece",
    description:
      "Advice on loading the next piece / blank: whether it is allowed now and how (N key or Next button). It only gives advice and cannot load the piece itself.",
  },
  machine_inference: {
    intent: "machine_inference",
    description:
      "In-process machine-level quality prediction (quality score, defect probability, top drivers) for the CNC machines (VMC 01, VMC 03, Turning Center 02). Omit 'machine' for all machines.",
    params: {
      machine: {
        type: "string",
        description: "Machine name or code, e.g. 'VMC 03', 'CNC-T02'. Optional.",
      },
    },
  },
};

const PANELS: Record<string, CopilotIntent> = {
  drawing: "open_drawing",
  trends: "open_trends",
  alerts: "open_alerts",
  process: "open_process",
  recommendations: "open_recommendations",
};

const TOOLS: AgentTool<CopilotContext>[] = [
  ...Object.entries(TOOL_DEFS).map(
    ([name, t]): AgentTool<CopilotContext> => ({
      name,
      description: t.description,
      parameters: t.params ? { properties: t.params } : undefined,
      run: (args, ctx) =>
        runCopilotTool(
          t.intent,
          {
            balloon: typeof args.balloon === "string" ? args.balloon : undefined,
            machine: typeof args.machine === "string" ? args.machine : undefined,
          },
          ctx,
        ),
    }),
  ),
  {
    name: "open_panel",
    description:
      "Link to a dashboard panel so the user can look at it: drawing (balloon map), trends (quality trend chart), alerts, process (process context), recommendations. Use for 'open / show / go to' requests.",
    parameters: {
      properties: {
        panel: {
          type: "string",
          enum: Object.keys(PANELS),
          description: "Which panel to open.",
        },
      },
      required: ["panel"],
    },
    run: (args, ctx) =>
      runCopilotTool(PANELS[String(args.panel)] ?? "open_drawing", {}, ctx),
  },
];

function systemPrompt(ctx?: CopilotContext): string {
  const sel = ctx?.selectedBalloonCode
    ? `The user currently has balloon ${ctx.selectedBalloonCode}${ctx.selectedCharacteristic ? ` (${ctx.selectedCharacteristic})` : ""} selected on the dashboard.`
    : "No balloon is selected on the dashboard.";
  return [
    "You are the PQM Copilot for a CNC predictive-quality dashboard (part: Valve Body A12 on a Makino Slim3n). Balloons are numbered drawing characteristics (B1..B17); each has a predicted risk: pass, warning, high risk or not machined.",
    "ALWAYS call tools to get data. Answer ONLY from tool results; never invent balloons, numbers, or limits. If a tool says a balloon does not exist, say so and give the valid codes. If a tool returns nothing relevant, say you have no data.",
    "Be concise (2-5 sentences or a short list). Put the direct answer in the first sentence (it may be read aloud); details and lists go after it. Reuse figures from tool output verbatim. Markdown **bold** is allowed. Do not output URLs; the UI shows action links itself.",
    "You can only give advice about loading the next piece; you cannot load it or change anything.",
    sel,
  ].join("\n");
}

/** Qwen picks tools (backed by the scripted handlers), then streams an answer. */
export function streamCopilot(
  message: string,
  ctx: CopilotContext | undefined,
  history: ChatTurn[],
  signal: AbortSignal,
): AsyncGenerator<CopilotStreamEvent> {
  return streamAgent<CopilotContext>({
    message,
    history,
    context: ctx,
    system: systemPrompt(ctx),
    tools: TOOLS,
    fallback: (m, c) => runCopilot(m, c),
    chips: () => DEFAULT_CHIPS,
    signal,
  });
}
