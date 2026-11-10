import { describe, expect, it } from "vitest";
import { streamCopilot, type CopilotStreamEvent } from "./llm";
import type { CopilotContext } from "./types";

/**
 * Live LLM tool-selection eval. Needs Ollama + the model, so it is opt-in:
 *   LLM_EVAL=1 npm test -- llm.eval
 */
const CTX: CopilotContext = {
  selectedBalloonId: "b17",
  selectedBalloonCode: "B17",
  selectedCharacteristic: "Diameter",
  selectedRisk: "high_risk",
  predictedValue: 20.028,
  passProbability: 0.12,
  simPhase: "machining",
  simLabel: "Machining B5",
  canLoadNext: false,
  summary: { pass: 9, warning: 1, highRisk: 1, notMachined: 0, total: 11 },
  highRiskCodes: ["B17"],
  warningCodes: ["B3"],
};

const CASES: { q: string; tool: string; href?: string; has?: RegExp }[] = [
  { q: "How is quality looking?", tool: "quality overview" },
  { q: "Which balloons are high risk?", tool: "list high risk balloons", has: /B17/ },
  { q: "Any balloons near the limit?", tool: "list warning balloons", has: /B3/ },
  { q: "Why is B3 flagged?", tool: "explain balloon", has: /B3|position/i },
  { q: "Tell me about B5", tool: "explain balloon", has: /B5|boss/i },
  { q: "Tell me about balloon B99", tool: "explain balloon", has: /B99/ },
  { q: "Show me the quality trend for B17", tool: "quality trend", href: "/dashboard#trend" },
  { q: "What should I do next?", tool: "next actions" },
  { q: "Is the machining simulation still running?", tool: "sim status" },
  { q: "Can I load the next piece now?", tool: "next piece advice" },
  { q: "What is the in-process defect probability on VMC 03?", tool: "machine inference" },
  { q: "Open the alerts panel", tool: "open panel", href: "/dashboard#alerts" },
];

async function collect(q: string) {
  const events: CopilotStreamEvent[] = [];
  for await (const e of streamCopilot(q, CTX, [], new AbortController().signal)) {
    events.push(e);
  }
  return {
    status: events.flatMap((e) => (e.type === "status" ? [e.text] : [])),
    text: events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join(""),
    done: events.find((e) => e.type === "done") as
      | Extract<CopilotStreamEvent, { type: "done" }>
      | undefined,
  };
}

describe.skipIf(!process.env.LLM_EVAL)("copilot LLM eval", () => {
  it.each(CASES)("$q → $tool", async ({ q, tool, href, has }) => {
    const r = await collect(q);
    expect(r.done?.source).toBe("llm");
    expect(r.status.join(" ").toLowerCase()).toContain(tool);
    expect(r.text.length).toBeGreaterThan(20);
    expect(r.text).not.toMatch(/<think>|https?:\/\//);
    if (has) expect(r.text).toMatch(has);
    if (href) expect(r.done!.actions.map((a) => a.href)).toContain(href);
  }, 120_000);
});
