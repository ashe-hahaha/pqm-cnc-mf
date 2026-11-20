import { describe, expect, it } from "vitest";
import { applyFrame, initialSignalsState, signalsWsUrl, type WireFrame } from "./signalsLive";

const wire = (type: "snapshot" | "delta", points: [string, number][], process: object[] = []): WireFrame => ({
  type, machine_id: "M1", start: "2026-11-19T00:00:00Z", end: "2026-11-19T00:00:10Z", t_max: "2026-11-19T00:00:10Z",
  channels: [{ channel: "ae.rms", bucket_ms: 100, points: points.map(([t, v]) => ({ t, min: v, max: v, first: v, last: v })) }],
  process: process as never[], status: { state: "live" },
});

describe("applyFrame", () => {
  it("replaces on snapshot and merges deltas, revised buckets replace in place", () => {
    const a = applyFrame(initialSignalsState(), wire("snapshot", [["2026-11-19T00:00:01Z", 1], ["2026-11-19T00:00:02Z", 2]], [{ timestamp: "2026-11-19T00:00:01Z", fanuc_raw_id: "a" }]), 1);
    expect(a.state.status).toBe("live");
    const b = applyFrame(a.state, wire("delta", [["2026-11-19T00:00:02Z", 5], ["2026-11-19T00:00:03Z", 3]], [{ timestamp: "2026-11-19T00:00:03Z", fanuc_raw_id: "b" }]), 2);
    expect(b.state.series["ae.rms"].points.map(p => p.max)).toEqual([1, 5, 3]);
    expect(b.state.process).toHaveLength(2);
    expect(b.rows).toHaveLength(1);
  });
  it("status and ping frames keep data", () => {
    const a = applyFrame(initialSignalsState(), wire("snapshot", [["2026-11-19T00:00:01Z", 1]]), 1).state;
    expect(applyFrame(a, { type: "status", state: "stale" }, 2).state.status).toBe("stale");
    expect(applyFrame(a, { type: "ping" }, 2).state).toBe(a);
  });
});

describe("signalsWsUrl", () => {
  it("maps http(s) and relative bases", () => {
    expect(signalsWsUrl("http://h:8000/", "M1", "http://x/")).toBe("ws://h:8000/api/signals/ws?machine_id=M1");
    expect(signalsWsUrl("/backend", undefined, "https://x/p")).toBe("wss://x/backend/api/signals/ws");
  });
});
