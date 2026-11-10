import { describe, expect, it } from "vitest";
import { classifyIntent, extractEntities } from "./nlu";
import { runCopilot } from "./tools";

describe("copilot nlu", () => {
  it("extracts balloon codes", () => {
    expect(extractEntities("Why is B17 risky?")).toEqual({
      balloonCode: "B17",
      balloonId: "b17",
    });
  });

  it("classifies core intents", () => {
    expect(classifyIntent("How is quality looking?", {}).intent).toBe(
      "quality_overview",
    );
    expect(classifyIntent("Which balloons are high risk?", {}).intent).toBe(
      "list_high_risk",
    );
    expect(classifyIntent("Show quality trend", {}).intent).toBe(
      "quality_trend",
    );
    expect(classifyIntent("Load next piece?", {}).intent).toBe("next_piece");
    expect(classifyIntent("What should I do next?", {}).intent).toBe(
      "next_actions",
    );
    expect(classifyIntent("hello", {}).intent).toBe("greet");
  });
});

describe("runCopilot", () => {
  it("answers high risk from live context", () => {
    const reply = runCopilot("Which balloons are high risk?", {
      summary: {
        pass: 2,
        warning: 1,
        highRisk: 1,
        notMachined: 0,
        total: 4,
      },
      highRiskCodes: ["B17"],
      warningCodes: ["B3"],
    });
    expect(reply.intent).toBe("list_high_risk");
    expect(reply.message).toContain("B17");
    expect(reply.actions.some((a) => a.href.includes("#drawing"))).toBe(true);
  });

  it("guides next piece in review", () => {
    const reply = runCopilot("Load next piece?", {
      simPhase: "review",
      canLoadNext: true,
      summary: {
        pass: 1,
        warning: 1,
        highRisk: 1,
        notMachined: 0,
        total: 3,
      },
    });
    expect(reply.intent).toBe("next_piece");
    expect(reply.message).toMatch(/N/);
  });
});
