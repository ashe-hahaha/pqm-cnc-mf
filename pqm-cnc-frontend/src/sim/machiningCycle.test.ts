import { describe, expect, it } from "vitest";
import type { DrawingBalloon } from "@/domain/opsDashboard";
import {
  createMachiningSim,
  planOutcomes,
  startNextPiece,
  tickMachiningSim,
} from "./machiningCycle";

const balloons: DrawingBalloon[] = [
  {
    id: "b1",
    code: "B1",
    characteristic: "A",
    characteristicType: "LENGTH",
    featureKind: "Hole",
    nominal: 10,
    upperTol: 0.02,
    lowerTol: 0.02,
    unit: "mm",
    critical: true,
    xPct: 20,
    yPct: 20,
    page: 1,
    risk: "not_machined",
  },
  {
    id: "b2",
    code: "B2",
    characteristic: "B",
    characteristicType: "LENGTH",
    featureKind: "Hole",
    nominal: 12,
    upperTol: 0.02,
    lowerTol: 0.02,
    unit: "mm",
    critical: false,
    xPct: 40,
    yPct: 40,
    page: 1,
    risk: "not_machined",
  },
  {
    id: "b3",
    code: "B3",
    characteristic: "C",
    characteristicType: "LENGTH",
    featureKind: "Hole",
    nominal: 8,
    upperTol: 0.02,
    lowerTol: 0.02,
    unit: "mm",
    critical: true,
    xPct: 60,
    yPct: 60,
    page: 1,
    risk: "not_machined",
  },
];

describe("planOutcomes", () => {
  it("passes every balloon on every piece", () => {
    for (const piece of [1, 7, 24]) {
      const out = planOutcomes(
        balloons.map((b) => b.id),
        piece,
      );
      expect(Object.keys(out)).toHaveLength(balloons.length);
      expect(Object.values(out).every((v) => v === "pass")).toBe(true);
    }
  });
});

describe("tickMachiningSim", () => {
  it("finishes balloons then holds in review until next piece is started", () => {
    let s = createMachiningSim(balloons, 23, 0);
    expect(s.phase).toBe("machining");
    expect(Object.values(s.risks).every((r) => r === "not_machined")).toBe(
      true,
    );

    s = tickMachiningSim(s, balloons, 30_000, 30_000);
    expect(s.nextIndex).toBe(1);
    expect(s.risks.b1).not.toBe("not_machined");
    expect(s.predictions.b1?.balloonId).toBe("b1");
    expect(s.processByBalloon.b1?.balloonId).toBe("b1");

    s = tickMachiningSim(s, balloons, 60_000, 30_000);
    s = tickMachiningSim(s, balloons, 90_000, 30_000);
    expect(s.phase).toBe("review");
    expect(Object.values(s.risks).some((r) => r !== "not_machined")).toBe(true);

    // Auto-tick does not advance while reviewing.
    const held = tickMachiningSim(s, balloons, 200_000, 30_000);
    expect(held).toBe(s);

    s = startNextPiece(s, balloons, 210_000);
    expect(s.phase).toBe("machining");
    expect(s.batchCompleted).toBe(24);
    expect(s.pieceIndex).toBe(25);
    expect(s.nextIndex).toBe(0);
    expect(Object.values(s.risks).every((r) => r === "not_machined")).toBe(
      true,
    );
  });
});
