import type { ChatTurn, CopilotAction, StreamEvent, ToolResult } from "../protocol.js";

export type JsonSchema = Record<string, unknown>;

export type AgentTool<C = unknown> = {
  name: string;
  description: string;
  /** JSON-schema `properties` + optional `required`; omit for a no-argument tool. */
  parameters?: JsonSchema;
  /** Status line shown while the tool runs. Default: "Checking <name>…". */
  statusText?: string;
  run: (args: Record<string, unknown>, ctx: C | undefined) => ToolResult | Promise<ToolResult>;
};

export type AgentLlmConfig = {
  /** Ollama base URL. Default: env LLM_BASE_URL or http://localhost:11434 */
  baseUrl?: string;
  /** Model name. Default: env LLM_MODEL or qwen3:32b */
  model?: string;
  maxRounds?: number;
  historyTurns?: number;
  temperature?: number;
  /** Abort if the model sends nothing for this long (allows a cold model load). */
  firstChunkTimeoutMs?: number;
  keepAlive?: string;
};

export type AgentOptions<C = unknown> = {
  message: string;
  history?: ChatTurn[];
  context?: C;
  system: string;
  tools: AgentTool<C>[];
  /** Scripted answer used when the LLM is unreachable before it produced any text. */
  fallback: (message: string, ctx: C | undefined) => (ToolResult & { chips?: string[] }) | Promise<ToolResult & { chips?: string[] }>;
  /** Suggested follow-up chips for the final event. */
  chips: (ctx: C | undefined) => string[];
  signal: AbortSignal;
  llm?: AgentLlmConfig;
};

type OllamaToolCall = { function: { name: string; arguments: Record<string, unknown> } };
type OllamaMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "");
}

async function* ollamaStream(
  cfg: Required<Pick<AgentLlmConfig, "baseUrl" | "model" | "temperature" | "keepAlive">>,
  messages: OllamaMsg[],
  tools: unknown[],
  signal: AbortSignal,
): AsyncGenerator<{ content?: string; tool_calls?: OllamaToolCall[] }> {
  const res = await fetch(`${cfg.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      stream: true,
      think: false,
      keep_alive: cfg.keepAlive,
      options: { temperature: cfg.temperature },
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as {
        message?: { content?: string; tool_calls?: OllamaToolCall[] };
      };
      if (j.message) yield j.message;
    }
  }
}

/**
 * Agent loop: the model picks tools, tool results are fed back, the final
 * answer streams as `token` events. Falls back to `opts.fallback` when the
 * LLM is unreachable before any text was produced.
 */
export async function* streamAgent<C = unknown>(
  opts: AgentOptions<C>,
): AsyncGenerator<StreamEvent> {
  const env = typeof process !== "undefined" ? process.env : {};
  const cfg = {
    baseUrl: opts.llm?.baseUrl ?? env.LLM_BASE_URL ?? "http://localhost:11434",
    model: opts.llm?.model ?? env.LLM_MODEL ?? "qwen3:32b",
    temperature: opts.llm?.temperature ?? 0.2,
    keepAlive: opts.llm?.keepAlive ?? "30m",
  };
  const maxRounds = opts.llm?.maxRounds ?? 4;
  const historyTurns = opts.llm?.historyTurns ?? 6;
  const firstChunkTimeout = opts.llm?.firstChunkTimeoutMs ?? 60_000;

  const toolDefs = opts.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: {}, ...(t.parameters ?? {}) },
    },
  }));
  const byName = new Map(opts.tools.map((t) => [t.name, t]));

  const messages: OllamaMsg[] = [
    { role: "system", content: opts.system },
    ...(opts.history ?? []).slice(-historyTurns).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: opts.message },
  ];
  const actions = new Map<string, CopilotAction>();
  let emitted = false;

  // Abort the request if the model produces nothing for too long; disarmed on first chunk.
  const ctl = new AbortController();
  opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => ctl.abort(),
    firstChunkTimeout,
  );
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  try {
    for (let round = 0; round < maxRounds; round++) {
      let text = "";
      let calls: OllamaToolCall[] = [];
      let inThink = false;
      for await (const part of ollamaStream(cfg, messages, toolDefs, ctl.signal)) {
        disarm();
        if (part.tool_calls?.length) calls = calls.concat(part.tool_calls);
        if (part.content) {
          text += part.content;
          // Hide any <think> block that slips through while streaming.
          let out = part.content;
          if (out.includes("<think>")) inThink = true;
          if (inThink) {
            if (out.includes("</think>")) {
              inThink = false;
              out = out.slice(out.indexOf("</think>") + 8);
            } else out = "";
          }
          if (out && calls.length === 0) {
            emitted = true;
            yield { type: "token", text: out };
          }
        }
      }
      messages.push({ role: "assistant", content: stripThink(text), tool_calls: calls });
      if (calls.length === 0) break;
      for (const c of calls) {
        const tool = byName.get(c.function.name);
        yield {
          type: "status",
          text: tool?.statusText ?? `Checking ${c.function.name.replace(/_/g, " ")}…`,
        };
        let content = "Unknown tool.";
        if (tool) {
          try {
            const r = await tool.run(c.function.arguments ?? {}, opts.context);
            for (const a of r.actions ?? []) actions.set(a.href, a);
            content = r.message;
          } catch (e) {
            content = `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`;
          }
        }
        messages.push({ role: "tool", tool_name: c.function.name, content });
      }
    }
  } catch {
    disarm();
    if (opts.signal.aborted) return;
    if (!emitted) {
      const r = await opts.fallback(opts.message, opts.context);
      yield { type: "token", text: r.message };
      yield {
        type: "done",
        actions: r.actions ?? [],
        chips: r.chips ?? opts.chips(opts.context),
        source: "scripted",
      };
      return;
    }
    yield { type: "token", text: "\n\n_(connection to the language model was interrupted)_" };
  }
  disarm();
  yield {
    type: "done",
    actions: [...actions.values()].slice(0, 4),
    chips: opts.chips(opts.context),
    source: "llm",
  };
}
