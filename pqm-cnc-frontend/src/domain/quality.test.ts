import { describe, expect, it } from "vitest";
import { cpk, deviationRatio, predictedScrapPct } from "./quality";

describe("cpk", () => {
  it("returns 1.33 for centered process at classic capability", () => {
    // USL-LSL = 12, sigma = 1.5 → (6)/(4.5) = 1.333…
    expect(cpk(10, 1.5, 4, 16)).toBeCloseTo(1.333, 2);
  });
});

describe("deviationRatio", () => {
  it("is 0 on nominal and 1 at upper limit", () => {
    expect(deviationRatio(10, 10, 1, 1)).toBe(0);
    expect(deviationRatio(11, 10, 1, 1)).toBe(1);
  });
});

describe("predictedScrapPct", () => {
  it("locks golden risk for mch-mill-03 style drivers", () => {
    // Documented golden for demo: moderate wear + mild thermal + healthy Cpk
    expect(
      predictedScrapPct({
        toolWearRatio: 0.55,
        thermalDriftRatio: 0.3,
        chatterIndex: 0.1,
        lastCpk: 1.4,
      }),
    ).toBe(3.6);
  });
});
