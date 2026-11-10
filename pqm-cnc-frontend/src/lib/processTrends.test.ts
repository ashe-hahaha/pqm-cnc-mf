import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROCESS_TREND_POINTS,
  buildProcessTrends,
  streamProcessContext,
} from "./processTrends";

describe("streamProcessContext", () => {
  const values = {
    feedMmMin: 1000,
    spindleRpm: 6000,
    spindleLoadPct: 40,
    mrrCm3Min: 2.5,
    estimatedDocMm: 0.3,
    estimatedWocMm: 2,
    vibrationRms: 1.5,
    acousticRms: 50,
  };

  const full = {
    balloonId: "b1",
    ...values,
    trends: buildProcessTrends(values, 3, false),
  };

  it("starts near the beginning of each series", () => {
    const early = streamProcessContext(full, 0);
    expect(early.trends.feed).toHaveLength(2);
    expect(early.trends.feed[0]).toBe(full.trends.feed[0]);
    expect(early.feedMmMin).toBe(early.trends.feed[1]);
  });

  it("grows toward a full series as progress approaches 1", () => {
    const mid = streamProcessContext(full, 0.5);
    expect(mid.trends.feed.length).toBeGreaterThan(2);
    expect(mid.trends.feed.length).toBeLessThan(PROCESS_TREND_POINTS);

    const done = streamProcessContext(full, 1);
    expect(done.trends.feed).toHaveLength(PROCESS_TREND_POINTS);
    expect(done.feedMmMin).toBe(full.trends.feed[PROCESS_TREND_POINTS - 1]);
  });

  it("resets length when progress returns to 0 (new balloon)", () => {
    const late = streamProcessContext(full, 0.9);
    const next = streamProcessContext(
      { ...full, balloonId: "b2" },
      0,
    );
    expect(late.trends.load.length).toBeGreaterThan(next.trends.load.length);
    expect(next.trends.load).toHaveLength(2);
  });
});

describe("buildProcessTrends", () => {
  const values = {
    feedMmMin: 1000,
    spindleRpm: 6000,
    spindleLoadPct: 40,
    mrrCm3Min: 2.5,
    estimatedDocMm: 0.3,
    estimatedWocMm: 2,
    vibrationRms: 1.5,
    acousticRms: 50,
  };

  it("builds step/plateau series with small random jitter", () => {
    const trends = buildProcessTrends(values, 11, false);
    expect(trends.feed[trends.feed.length - 1]).toBe(values.feedMmMin);

    // Neighbor deltas are usually small (noise), with a few large jumps (steps).
    const deltas: number[] = [];
    for (let i = 1; i < trends.feed.length; i++) {
      deltas.push(Math.abs(trends.feed[i]! - trends.feed[i - 1]!));
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const max = sorted[sorted.length - 1]!;
    expect(median).toBeLessThan(values.feedMmMin * 0.03);
    expect(max).toBeGreaterThan(values.feedMmMin * 0.02);
    // Noise should actually move points (not perfectly flat plateaus).
    expect(median).toBeGreaterThan(0);
  });

  it("has no sinusoidal terms in the signal generators", () => {
    for (const f of ["processTrends.ts", "hfSensors.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/Math\.(sin|cos|tan)\b/);
    }
  });

  it("plateau jitter is bounded and not periodic", () => {
    const trends = buildProcessTrends(values, 11, false);
    // Every sample stays within the largest step band around the current level.
    for (const v of trends.spindle) {
      expect(Math.abs(v - values.spindleRpm)).toBeLessThan(values.spindleRpm * 0.2);
    }
    // Different seeds give different jitter (not a fixed phase-shifted sine).
    const a = buildProcessTrends(values, 11, false).feed;
    const b = buildProcessTrends(values, 12, false).feed;
    expect(a).not.toEqual(b);
  });
});
