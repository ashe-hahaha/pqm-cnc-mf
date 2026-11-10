import { describe, expect, it } from "vitest";
import { createManualBalloon, createManualBalloons } from "./manualBalloons";

describe("manualBalloons", () => {
  it("creates sequential codes", () => {
    const a = createManualBalloon([], 1, 10, 20);
    expect(a.code).toBe("B1");
    expect(a.source).toBe("manual");
    const b = createManualBalloon([a], 2, 30, 40);
    expect(b.code).toBe("B2");
    expect(b.page).toBe(2);
  });

  it("adds multiple balloons in one call", () => {
    const created = createManualBalloons([], 1, 50, 50, 3);
    expect(created).toHaveLength(3);
    expect(created.map((b) => b.code)).toEqual(["B1", "B2", "B3"]);
  });
});
