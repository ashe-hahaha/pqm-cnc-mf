import { describe, expect, it } from "vitest";
import { applyTolerances, validateTolerance } from "./balloonTolerance";

const balloon = (id: string, upperTol: number) => ({ id, nominal: 0, upperTol, lowerTol: 0 }) as never;

describe("balloon tolerance", () => {
  it("validates numbers and signs", () => {
    expect(validateTolerance({ nominal: 0, upperTol: 0.02, lowerTol: 0 })).toBeNull();
    expect(validateTolerance({ nominal: 0, upperTol: -1, lowerTol: 0 })).not.toBeNull();
    expect(validateTolerance({ nominal: Number.NaN, upperTol: 0, lowerTol: 0 })).not.toBeNull();
  });

  it("overrides only the matching balloon", () => {
    const [b1, b2] = applyTolerances([balloon("b1", 0.02), balloon("b2", 0.02)], {
      b1: { nominal: 1, upperTol: 0.05, lowerTol: 0.03 },
    }) as unknown as { nominal: number; upperTol: number; lowerTol: number }[];
    expect(b1).toMatchObject({ nominal: 1, upperTol: 0.05, lowerTol: 0.03 });
    expect(b2).toMatchObject({ nominal: 0, upperTol: 0.02, lowerTol: 0 });
  });
});
