/**
 * Pure quality metrics for Phase D (unit-tested).
 * Phase P may replace inputs; keep formulas stable for demo trust.
 */

export function cpk(
  mean: number,
  sigma: number,
  lowerSpec: number,
  upperSpec: number,
): number {
  if (sigma <= 0) return Number.POSITIVE_INFINITY;
  const cpu = (upperSpec - mean) / (3 * sigma);
  const cpl = (mean - lowerSpec) / (3 * sigma);
  return Math.min(cpu, cpl);
}

/** |value - nominal| / tolerance half-width (0 = on nominal, 1 = at limit). */
export function deviationRatio(
  value: number,
  nominal: number,
  lowerTol: number,
  upperTol: number,
): number {
  const half =
    value >= nominal
      ? Math.max(upperTol, Number.EPSILON)
      : Math.max(Math.abs(lowerTol), Number.EPSILON);
  return Math.abs(value - nominal) / half;
}

/**
 * Heuristic predicted scrap % from residual risk drivers (0–100).
 * Tunable for demos; golden tests lock the contract for seed fixtures.
 */
export function predictedScrapPct(input: {
  toolWearRatio: number;
  thermalDriftRatio: number;
  chatterIndex: number;
  lastCpk: number;
}): number {
  const wear = clamp01(input.toolWearRatio) * 4;
  const thermal = clamp01(input.thermalDriftRatio) * 3;
  const chatter = clamp01(input.chatterIndex) * 5;
  const cpkPenalty =
    input.lastCpk >= 1.33 ? 0 : input.lastCpk >= 1.0 ? 2 : 6;
  return round1(Math.min(25, wear + thermal + chatter + cpkPenalty));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
