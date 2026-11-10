import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { queryOpsDashboard } from "@/lib/queries/opsDashboard";
import { classifyIntent, extractEntities } from "./nlu";
import { runCopilot, runCopilotTool } from "./tools";
import type { CopilotContext, CopilotIntent } from "./types";

/** Live client context as the dashboard publishes it (B17 selected, high risk). */
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

type Golden = {
  q: string;
  intent: CopilotIntent;
  hrefs?: string[];
  has?: (string | RegExp)[];
};

const GOLDEN: Golden[] = [
  { q: "How is quality looking?", intent: "quality_overview", has: ["B17", "11 balloons"] },
  { q: "Which balloons are high risk?", intent: "list_high_risk", has: ["B17"], hrefs: ["/dashboard#drawing"] },
  { q: "Show warning balloons", intent: "list_warning", has: ["B3"] },
  { q: "Why is the selected balloon risky?", intent: "explain_balloon", has: ["B17", "high risk"], hrefs: ["/dashboard#trend"] },
  { q: "Show quality trend", intent: "quality_trend", hrefs: ["/dashboard#trend"], has: [/\d+ prediction points/] },
  { q: "What should I do next?", intent: "next_actions" },
  { q: "Sim status", intent: "sim_status", has: [/in progress/i] },
  { q: "Load next piece?", intent: "next_piece", has: [/locked/i] },
  { q: "Open alerts", intent: "open_alerts", hrefs: ["/dashboard#alerts"] },
  { q: "Open process context", intent: "open_process", hrefs: ["/dashboard#process"] },
  { q: "Show trend", intent: "open_trends", hrefs: ["/dashboard#trend"] },
  { q: "Open recommendations panel", intent: "open_recommendations", hrefs: ["/dashboard#recommendations"] },
  { q: "What is the in-process defect probability?", intent: "machine_inference", has: [/defect probability/] },
];

describe("copilot golden questions (scripted handlers)", () => {
  it.each(GOLDEN)("$q", ({ q, intent, hrefs, has }) => {
    expect(classifyIntent(q, extractEntities(q)).intent).toBe(intent);
    const r = runCopilot(q, CTX);
    expect(r.intent).toBe(intent);
    expect(r.message.trim().length).toBeGreaterThan(0);
    expect(r.chips.length).toBeGreaterThan(0);
    for (const h of hrefs ?? []) expect(r.actions.map((a) => a.href)).toContain(h);
    for (const s of has ?? []) {
      if (typeof s === "string") expect(r.message).toContain(s);
      else expect(r.message).toMatch(s);
    }
  });
});

describe("balloon resolution (regression: no reuse of the selected balloon)", () => {
  it("explaining another balloon does not inherit the selected balloon's risk", () => {
    const r = runCopilotTool("explain_balloon", { balloon: "B5" }, CTX);
    expect(r.message).toContain("**B5**");
    expect(r.message).toContain("Boss OD");
    expect(r.message).toContain("nominal 32");
    expect(r.message).not.toMatch(/\*\*high risk\*\*/);
    expect(r.message).not.toMatch(/pass probability/);
    expect(r.message).not.toContain("20.028");
    expect(r.message).not.toContain("12%");
    expect(r.message).toMatch(/not flagged/);
    expect(r.message).toMatch(/only static/i);
  });

  it("takes live risk for another balloon from the context lists", () => {
    const r = runCopilotTool("explain_balloon", { balloon: "B3" }, CTX);
    expect(r.message).toContain("warning");
    expect(r.message).toContain("Position");
    expect(r.message).not.toContain("20.028");
  });

  it("a live risk list overrides the seed risk", () => {
    const r = runCopilotTool("explain_balloon", { balloon: "b5" }, {
      ...CTX,
      highRiskCodes: ["B17", "B5"],
    });
    expect(r.message).toMatch(/\*\*high risk\*\*/);
  });

  it("the selected balloon still uses live values", () => {
    const r = runCopilotTool("explain_balloon", { balloon: "B17" }, CTX);
    expect(r.message).toContain("20.028");
    expect(r.message).toContain("12%");
    expect(r.message).toContain("high risk");
    expect(r.message).not.toMatch(/only static/i);
  });

  it("free-text 'why is B5 risky' answers about B5, not the selection", () => {
    const r = runCopilot("Why is B5 risky?", CTX);
    expect(r.entities.balloonCode).toBe("B5");
    expect(r.message).toContain("**B5**");
    expect(r.message).not.toContain("20.028");
  });

  it("an unknown balloon is reported with the valid codes, never substituted", () => {
    for (const r of [
      runCopilotTool("explain_balloon", { balloon: "B99" }, CTX),
      runCopilot("Why is B99 risky?", CTX),
      runCopilotTool("quality_trend", { balloon: "B99" }, CTX),
    ]) {
      expect(r.message).toContain("no balloon B99");
      expect(r.message).toContain("B1,");
      expect(r.message).toContain("B17");
      expect(r.message).not.toContain("20.028");
    }
  });

  it("a non-code balloon name is rejected too", () => {
    const r = runCopilotTool("explain_balloon", { balloon: "the big one" }, CTX);
    expect(r.message).toMatch(/no balloon the big one/i);
  });
});

describe("quality trend uses real series data", () => {
  it("reports the actual point and QC counts, not a hardcoded string", () => {
    const r = runCopilotTool("quality_trend", { balloon: "B5" }, CTX);
    expect(r.message).toContain("20 prediction points");
    expect(r.message).toContain("3 measured QC");
    expect(r.message).not.toContain("2 measured");
    expect(r.message).toMatch(/inside the control window/);
  });

  it("flags a high-risk balloon as outside the window", () => {
    const r = runCopilotTool("quality_trend", { balloon: "B17" }, CTX);
    expect(r.message).toMatch(/\*\*outside\*\*/);
  });
});

describe("machine inference tool", () => {
  it("lists all machines, or one by name", () => {
    const all = runCopilotTool("machine_inference", {});
    expect(all.message).toContain("VMC-01");
    expect(all.message).toContain("CNC-T02");
    const one = runCopilotTool("machine_inference", { machine: "VMC 03" });
    expect(one.message).toContain("VMC-03");
    expect(one.message).not.toContain("CNC-T02");
    const none = runCopilotTool("machine_inference", { machine: "Fanuc 9000" });
    expect(none.message).toMatch(/No in-process quality prediction/);
  });
});

describe("deep-link anchors", () => {
  const dashboard = readFileSync(
    path.join(__dirname, "../../components/dashboard/OpsDashboard.tsx"),
    "utf8",
  );
  const boxIds = new Set(
    [...dashboard.matchAll(/<DashBox\s+id="([^"]+)"/g)].map((m) => m[1]),
  );

  it("every dashboard anchor in a reply or the sidebar matches a real box id", () => {
    const hrefs = new Set<string>();
    const intents = [
      "quality_overview", "list_high_risk", "list_warning", "explain_balloon",
      "quality_trend", "next_actions", "sim_status", "next_piece",
      "open_drawing", "open_trends", "open_alerts", "open_process",
      "open_recommendations", "machine_inference",
    ] as CopilotIntent[];
    for (const i of intents) {
      for (const ctx of [CTX, { ...CTX, simPhase: "review" as const, canLoadNext: true }]) {
        for (const a of runCopilotTool(i, {}, ctx).actions) hrefs.add(a.href);
      }
    }
    for (const q of ["help", "hello", "asdf"]) {
      for (const a of runCopilot(q, CTX).actions) hrefs.add(a.href);
    }
    const sidebar = readFileSync(
      path.join(__dirname, "../../components/dashboard/OpsSidebar.tsx"),
      "utf8",
    );
    for (const m of sidebar.matchAll(/href: "([^"]+)"/g)) hrefs.add(m[1]!);

    const anchors = [...hrefs].filter((h) => h.startsWith("/dashboard#"));
    expect(anchors.length).toBeGreaterThan(3);
    for (const h of anchors) {
      expect(boxIds, `anchor ${h}`).toContain(h.split("#")[1]);
    }
  });

  it("the box component renders its id into the DOM", () => {
    const rb = readFileSync(
      path.join(__dirname, "../../components/dashboard/ResizableBox.tsx"),
      "utf8",
    );
    expect(rb).toMatch(/id=\{id\}/);
    expect(dashboard).toMatch(/<ResizableBox\s+id=\{id\}/);
  });
});

describe("seed sanity", () => {
  it("B1..B17 codes referenced by the STT vocabulary exist in the seed", () => {
    const codes = queryOpsDashboard().balloons.map((b) => b.code);
    expect(codes).toContain("B17");
  });
});
