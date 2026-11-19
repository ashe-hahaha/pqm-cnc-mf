// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWearHistory } from "./useWearHistory";

let root: Root, host: HTMLDivElement;
let latest: ReturnType<typeof useWearHistory>;
function View({ minutes = 60, start, end }: { minutes?: number; start?: string; end?: string }) {
  const state = useWearHistory(minutes, start, end);
  latest = state;
  return React.createElement("pre", null, JSON.stringify(state));
}
const result = { machine_id: "M1", environment: "real", start: null, end: null, totalPoints: 1, downsampled: false,
  data: [{ timestampEpoch: 1, timestamp: "1970-01-01T00:00:00.001Z", toolNo: null, xWearMm: -0.1, zWearMm: 0, xSegment: 0, zSegment: 0 }] };
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => result }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("requests once without polling, and again only on reload() or when the parameters change", async () => {
  await act(async () => root.render(React.createElement(View)));
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("window_minutes=60");
  expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain("tool_no");
  expect(host.textContent).toContain('"toolNo":null');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).toHaveBeenCalledTimes(1);          // no polling

  await act(async () => latest.reload());
  expect(fetch).toHaveBeenCalledTimes(2);          // manual refresh

  await act(async () => root.render(React.createElement(View, { start: "2026-11-01T00:00:00.000Z", end: "2026-11-04T00:00:00.000Z" })));
  expect(fetch).toHaveBeenCalledTimes(3);          // new dates are requested ...
  expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain("start=2026-11-01");
  await act(async () => latest.reload());
  const last = String(vi.mocked(fetch).mock.calls[3][0]);
  expect(last).toContain("start=2026-11-01");      // ... and a refresh keeps using them
  expect(last).toContain("end=2026-11-04");
});

it("reports fetching while a request is in flight and keeps the old data during a refresh", async () => {
  await act(async () => root.render(React.createElement(View)));
  expect(latest.fetching).toBe(false);
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => latest.reload());
  expect(latest.fetching).toBe(true);
  expect(latest.data).not.toBeNull();              // previous result stays visible
  await act(async () => finish({ ok: true, json: async () => result } as Response));
  expect(latest.fetching).toBe(false);
});

it("preserves previous results on failure and clears them when the time range changes", async () => {
  await act(async () => root.render(React.createElement(View)));
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502 } as Response);
  await act(async () => latest.reload());
  expect(host.textContent).toContain("502");
  expect(host.textContent).toContain('"xWearMm":-0.1');
  await act(async () => root.render(React.createElement(View, { minutes: 15 })));
  expect(host.textContent).toContain('"data":null');
});
