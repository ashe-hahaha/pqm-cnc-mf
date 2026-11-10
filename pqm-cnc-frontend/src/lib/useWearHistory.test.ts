// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWearHistory } from "./useWearHistory";

let root: Root, host: HTMLDivElement;
function View({ minutes = 60 }: { minutes?: number }) {
  const state = useWearHistory(minutes);
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

it("fetches one shared history without a tool filter and refreshes after 5 seconds", async () => {
  await act(async () => root.render(React.createElement(View)));
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("window_minutes=60");
  expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain("tool_no");
  expect(host.textContent).toContain('"toolNo":null');
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves previous results on failure and clears them when the time range changes", async () => {
  await act(async () => root.render(React.createElement(View)));
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502 } as Response);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.textContent).toContain("502");
  expect(host.textContent).toContain('"xWearMm":-0.1');
  await act(async () => root.render(React.createElement(View, { minutes: 15 })));
  expect(host.textContent).toContain('"data":null');
});
