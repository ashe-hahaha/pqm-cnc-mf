import type { InProcessLabel, QualityResult } from "@/domain/types";

export type Traffic = "green" | "gold" | "red";

/** Machine in-process quality score (0–100, higher = healthier). */
export function qualityScoreTraffic(score: number): Traffic {
  if (score >= 80) return "green";
  if (score >= 65) return "gold";
  return "red";
}

export function labelToTraffic(label: InProcessLabel): Traffic {
  if (label === "ok") return "green";
  if (label === "watch") return "gold";
  return "red";
}

/** Predicted scrap risk (%) */
export function scrapRiskTraffic(pct: number): Traffic {
  if (pct < 2) return "green";
  if (pct <= 5) return "gold";
  return "red";
}

/** Cpk for critical characteristics */
export function cpkTraffic(cpk: number): Traffic {
  if (cpk >= 1.33) return "green";
  if (cpk >= 1.0) return "gold";
  return "red";
}

/** |deviation| / tolerance half-width */
export function deviationTraffic(ratio: number): Traffic {
  if (ratio < 0.5) return "green";
  if (ratio <= 0.8) return "gold";
  return "red";
}

/** Worst-of composite for map balloons */
export function compositeHealth(input: {
  predictedScrapPct: number;
  avgCpk: number;
  maxDeviationRatio: number;
}): Traffic {
  const ranks: Record<Traffic, number> = { green: 0, gold: 1, red: 2 };
  const worst = [
    scrapRiskTraffic(input.predictedScrapPct),
    cpkTraffic(input.avgCpk),
    deviationTraffic(input.maxDeviationRatio),
  ].sort((a, b) => ranks[b] - ranks[a])[0];
  return worst;
}

export function withHealth(
  partial: Omit<QualityResult, "health">,
): QualityResult {
  return {
    ...partial,
    health: compositeHealth(partial),
  };
}
