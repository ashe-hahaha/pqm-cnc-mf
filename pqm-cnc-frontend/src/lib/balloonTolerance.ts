import type { DrawingBalloon } from "@/domain/opsDashboard";

export type Tolerance = Pick<DrawingBalloon, "nominal" | "upperTol" | "lowerTol">;

const STORAGE_KEY = "pqm.balloonTolerances";

/** Accepts finite numbers with non-negative tolerances; returns an error message otherwise. */
export function validateTolerance(t: Tolerance): string | null {
  if (![t.nominal, t.upperTol, t.lowerTol].every(Number.isFinite)) return "Enter valid numbers.";
  if (t.upperTol < 0 || t.lowerTol < 0) return "Tolerances cannot be negative.";
  return null;
}

/** Apply user-set tolerances on top of the balloons' own values. */
export function applyTolerances(
  balloons: DrawingBalloon[],
  overrides: Record<string, Tolerance>,
): DrawingBalloon[] {
  if (Object.keys(overrides).length === 0) return balloons;
  return balloons.map((b) => {
    const o = overrides[b.id];
    return o ? { ...b, nominal: o.nominal, upperTol: o.upperTol, lowerTol: o.lowerTol } : b;
  });
}

export function readTolerances(): Record<string, Tolerance> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Record<string, Tolerance> | null;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => t && validateTolerance(t) === null));
  } catch {
    return {};
  }
}

export function writeTolerances(overrides: Record<string, Tolerance>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable */
  }
}
