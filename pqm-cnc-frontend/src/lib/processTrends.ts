import { hash01 } from "@/lib/prng";
import type {
  BalloonProcessContext,
  ProcessTrends,
} from "@/domain/opsDashboard";

/** Points in a full process-parameter sparkline (also used as stream capacity). */
export const PROCESS_TREND_POINTS = 24;

/**
 * Build per-parameter trend series that end at the live scalar values
 * shown in Process context (so sparklines match the left-hand readout).
 *
 * Series are step/plateau shaped — CNC setpoints jump, then hold — not smooth curves.
 */
export function buildProcessTrends(
  values: {
    feedMmMin: number;
    spindleRpm: number;
    spindleLoadPct: number;
    mrrCm3Min: number;
    estimatedDocMm: number;
    estimatedWocMm: number;
    vibrationRms: number;
    acousticRms: number;
  },
  seed: number,
  risingRisk = false,
): ProcessTrends {
  return {
    feed: sparkSteps(values.feedMmMin, seed, { stepPct: 0.04 }),
    spindle: sparkSteps(values.spindleRpm, seed + 1, { stepPct: 0.03 }),
    load: sparkSteps(values.spindleLoadPct, seed + 2, {
      stepPct: risingRisk ? 0.18 : 0.06,
      rising: risingRisk,
    }),
    mrr: sparkSteps(values.mrrCm3Min, seed + 3, { stepPct: 0.05 }),
    doc: sparkSteps(values.estimatedDocMm, seed + 4, { stepPct: 0.02 }),
    woc: sparkSteps(values.estimatedWocMm, seed + 5, { stepPct: 0.03 }),
    vib: sparkSteps(values.vibrationRms, seed + 6, {
      stepPct: risingRisk ? 0.22 : 0.05,
      rising: risingRisk,
    }),
    acoustic: sparkSteps(values.acousticRms, seed + 7, {
      stepPct: risingRisk ? 0.16 : 0.04,
      rising: risingRisk,
    }),
  };
}

/**
 * Reveal process trends progressively over a balloon cycle (0 → 1).
 * Live scalars track the latest streamed sample so the panel updates in lockstep.
 * Progress near 0 keeps a short prefix — next balloon resets to the start of the graph.
 */
export function streamProcessContext(
  full: BalloonProcessContext,
  progress: number,
): BalloonProcessContext {
  const p = Math.min(1, Math.max(0, progress));
  const visible = Math.max(
    2,
    Math.min(PROCESS_TREND_POINTS, Math.ceil(p * PROCESS_TREND_POINTS)),
  );
  const trends: ProcessTrends = {
    feed: full.trends.feed.slice(0, visible),
    spindle: full.trends.spindle.slice(0, visible),
    load: full.trends.load.slice(0, visible),
    mrr: full.trends.mrr.slice(0, visible),
    doc: full.trends.doc.slice(0, visible),
    woc: full.trends.woc.slice(0, visible),
    vib: full.trends.vib.slice(0, visible),
    acoustic: full.trends.acoustic.slice(0, visible),
  };
  const i = visible - 1;
  return {
    ...full,
    feedMmMin: trends.feed[i] ?? full.feedMmMin,
    spindleRpm: trends.spindle[i] ?? full.spindleRpm,
    spindleLoadPct: trends.load[i] ?? full.spindleLoadPct,
    mrrCm3Min: trends.mrr[i] ?? full.mrrCm3Min,
    estimatedDocMm: trends.doc[i] ?? full.estimatedDocMm,
    estimatedWocMm: trends.woc[i] ?? full.estimatedWocMm,
    vibrationRms: trends.vib[i] ?? full.vibrationRms,
    acousticRms: trends.acoustic[i] ?? full.acousticRms,
    trends,
  };
}

/**
 * Step/plateau series ending at `current`.
 * Discrete levels with sudden jumps, plus small uniform random jitter on each
 * hold (like the PdM machine parameters) — no sinusoidal component.
 */
function sparkSteps(
  current: number,
  seed: number,
  opts: { stepPct: number; rising?: boolean; noisePct?: number },
): number[] {
  const n = PROCESS_TREND_POINTS;
  const noisePct = opts.noisePct ?? 0.012;
  const rnd = (k: number) => hash01(seed, k);

  const levelCount = 2 + Math.floor(rnd(0) * 2); // 2 or 3 plateaus
  const levels: number[] = new Array(levelCount);

  if (opts.rising) {
    // Elevated finish: climb in abrupt steps toward `current`.
    for (let L = 0; L < levelCount; L++) {
      const t = L / (levelCount - 1);
      levels[L] = current * (1 - opts.stepPct * (1 - t));
    }
    levels[levelCount - 1] = current;
  } else {
    for (let L = 0; L < levelCount - 1; L++) {
      const sign = rnd(10 + L) > 0.5 ? -1 : 1;
      const mag = opts.stepPct * (0.55 + rnd(20 + L) * 0.9);
      levels[L] = Math.max(0, current * (1 + sign * mag));
    }
    levels[levelCount - 1] = current;
  }

  // Plateau boundaries (at least 3 samples each when possible).
  const cuts: number[] = [0];
  for (let L = 1; L < levelCount; L++) {
    const ideal = Math.round((L / levelCount) * n);
    const jitter = Math.round((rnd(30 + L) - 0.5) * 3);
    const minStart = cuts[L - 1]! + 3;
    const maxStart = n - 3 * (levelCount - L);
    cuts.push(clamp(ideal + jitter, minStart, Math.max(minStart, maxStart)));
  }
  cuts.push(n);

  const out: number[] = [];
  for (let L = 0; L < levelCount; L++) {
    const base = levels[L]!;
    const start = cuts[L]!;
    const end = cuts[L + 1]!;
    for (let i = start; i < end; i++) {
      // Uniform jitter in ±noisePct of the plateau level.
      const jitter = base * noisePct * 2 * (rnd(100 + i) - 0.5);
      out.push(roundFor(Math.max(0, base + jitter)));
    }
  }
  out[n - 1] = roundFor(current);
  return out;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function roundFor(v: number): number {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  if (v >= 1) return Math.round(v * 100) / 100;
  return Math.round(v * 1000) / 1000;
}
