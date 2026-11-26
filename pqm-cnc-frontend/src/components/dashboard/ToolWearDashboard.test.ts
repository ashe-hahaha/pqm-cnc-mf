// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolWearDashboard } from "./ToolWearDashboard";
import type { ControllerRow } from "@/lib/useControllerData";
import type { WearAlertSnapshot } from "./WearAlertDemo";

const demoSnapshot = (): WearAlertSnapshot => ({
  enabled: true, thresholds: { diameter: 0.1, length: 0.1 }, prediction: null, alerts: [],
  history: [{ machineId: "Makino_01", toolNo: "25", timestampUtc: new Date().toISOString(), diameter: 0.05, length: 0.02 }],
});

const controllerSamples = vi.hoisted(() => ({ callback: undefined as
  ((rows: ControllerRow[], receivedAt: string, machine: string) => void) | undefined }));

it("opens the session event history from the latest event row", async () => {
  const row = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  expect(row().textContent).toContain("No event");
  await act(async () => root.render(React.createElement(ToolWearDashboard, {
    currentTool: "T25",
    events: [
      { id: "start", timestampUtc: "2026-11-11T00:00:00Z", label: "Prediction started", toolNo: "25" },
      { id: "done", timestampUtc: "2026-11-11T00:00:03Z", label: "Prediction completed", toolNo: "25" },
    ],
  })));
  expect(row().textContent).toContain("Prediction completed");
  const dialog = host.querySelector<HTMLDialogElement>('dialog[aria-label="Tool wear event history"]')!;
  Object.defineProperty(dialog, "showModal", { value: () => dialog.setAttribute("open", "") });
  await act(async () => row().click());
  expect(dialog.open).toBe(true);
  expect([...dialog.querySelectorAll("li > p")].map(item => item.textContent)).toEqual([
    "T25 · Prediction completed", "T25 · Prediction started",
  ]);
});

vi.mock("@/lib/useToolImage", () => ({ useToolImage: () => ({ status: "connected", image: {
  captureId: "capture-167", machineId: "Makino_01", toolNo: "167", timestampUtc: "2026-11-03T09:20:20Z",
  imageUrl: "http://127.0.0.1:8000/api/tool-images/capture-167/image", inspectionResult: "Wear checked",
} }) }));

vi.mock("@/lib/useControllerData", () => ({
  useControllerData: (_keep: boolean, callback: typeof controllerSamples.callback) => {
    controllerSamples.callback = callback;
    return { status: "live", latestByTool: { "25": { timestamp: "2026-10-29T00:00:00Z", tool_no: 25, receivedAt: "2026-10-29T00:00:01Z", xWearMm: 0.34, zWearMm: 0.19, xGeometryMm: 2, zGeometryMm: 10 } } };
  },
  controllerOffset: (row: { xWearMm: number; zWearMm: number; xGeometryMm: number; zGeometryMm: number } | undefined, axis: "x" | "z") => {
    const wear = row?.[axis === "x" ? "xWearMm" : "zWearMm"] ?? null;
    const geometry = row?.[axis === "x" ? "xGeometryMm" : "zGeometryMm"] ?? null;
    return { wear, geometry, offset: wear !== null && geometry !== null ? wear + geometry : null };
  },
}));
const historyState = vi.hoisted(() => ({ data: {
  start: "2026-11-04T00:00:00Z", end: "2026-11-04T01:00:00Z", machine_id: "Makino_01", environment: "real", totalPoints: 2, downsampled: false,
  data: [
    { timestamp: "2026-11-04T00:10:00Z", timestampEpoch: 1793751000000, toolNo: null, xWearMm: -0.1, zWearMm: 0.2, xSegment: 0, zSegment: 0 },
    { timestamp: "2026-11-04T00:20:00Z", timestampEpoch: 1793751600000, toolNo: null, xWearMm: 0, zWearMm: 0.3, xSegment: 0, zSegment: 0 },
  ],
}, error: null as string | null, loading: false, fetching: false, reload: vi.fn(), discoveredTools: ["167", "unknown"] }));
const historyCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/useWearHistory", () => ({ useWearHistory: (...args: unknown[]) => { historyCalls.push(args); return historyState; } }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T06", wearDemo: demoSnapshot() })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("logs wear only when a tool's valid values change, including overlapping windows and partial readings", async () => {
  const onEvents = vi.fn();
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T25", onEvents })));
  const send = (second: number, x: number | null, z: number | null, tool: string | null = "25", machine = "M1") => {
    controllerSamples.callback!([{ timestamp: `2026-11-12T00:00:${String(second).padStart(2, "0")}Z`,
      tool_no: tool, xWearMm: x, zWearMm: z }], "2026-11-12T00:01:00Z", machine);
  };
  send(1, 0.1, 0.2);                           // first valid reading
  send(2, 0.1, 0.2);                           // same values, new timestamp
  send(3, null, 0.2);                          // missing X is not a change
  send(4, null, null);
  expect(onEvents).toHaveBeenCalledTimes(1);
  send(5, 0.15, 0.2);                          // X changed
  send(1, 0.1, 0.2);                           // old window replay
  send(6, 0.15, 0.2, "025");                  // same normalized tool
  expect(onEvents).toHaveBeenCalledTimes(2);
  send(7, 0.1, 0.2);                           // returning to an earlier value is a change
  send(8, 0.1, 0.2, "26");                    // separate tool
  send(9, 0.1, 0.2, "25", "M2");              // separate machine
  send(10, 0.1, 0.2, null);                    // unknown tool also deduplicates
  send(11, 0.1, 0.2, null);
  expect(onEvents).toHaveBeenCalledTimes(6);
});

it("shows both health outputs and separate trend charts without offset or feedback controls", () => {
  expect(host.querySelector('[aria-label="Diameter wear health"]')?.textContent).toContain("0.340");
  expect(host.querySelector('[aria-label="Tool length wear health"]')?.textContent).toContain("0.190");
  expect(host.textContent).toContain("Offset 2.340 mm");
  expect(host.textContent).toContain("Offset 10.190 mm");
  expect(host.querySelector('svg[aria-label^="Predicted wear history"]')).not.toBeNull();
  const cards = [...host.querySelectorAll('[aria-label="Tool selection"] button')];
  expect(cards.map(card => card.getAttribute("aria-label"))).toEqual(["T25", "T167", "Unknown tool"]);
  expect(cards[0].getAttribute("aria-pressed")).toBe("true");
  expect(cards[0].textContent).toContain("0.340 mm");
  expect(cards[0].querySelector('time[datetime="2026-10-29T00:00:01Z"]')).not.toBeNull();
  expect(cards[1].textContent).toContain("No controller sample yet");
  expect(host.textContent).not.toContain("mock");
  expect(host.querySelectorAll("[data-tool-block]")).toHaveLength(5);
  const historyBlock = host.querySelector('[data-tool-block="wear-history"]');
  expect(historyBlock?.querySelectorAll('input[type="date"]')).toHaveLength(2);
  expect(historyBlock?.querySelectorAll('svg[aria-label^="Predicted wear history"]')).toHaveLength(1);
  expect(host.textContent).not.toContain("Apply offset");
  expect(host.textContent).not.toContain("Machine feedback");
  expect(host.querySelector("#wear-dimension")).toBeNull();
  expect(host.textContent).not.toContain("Tool wear simulation");
  expect(host.querySelector("#wear-scenario")).toBeNull();
});

it("keeps the last successful charts on a history error without announcing it", async () => {
  historyState.error = "History request failed (502)";
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T06", wearDemo: demoSnapshot() })));
  expect(host.textContent).not.toContain("History request failed");
  expect(host.querySelector('svg[aria-label^="Predicted wear history"]')).not.toBeNull();
  historyState.error = null;
});

it("switches to another tool without showing the previous controller reading", async () => {
  const card = host.querySelector<HTMLButtonElement>('button[aria-label="T167"]')!;
  await act(async () => card.click());
  expect(card.getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Predicted wear history · T167");
  expect(host.querySelector('[aria-label="Diameter wear health"]')?.textContent).not.toContain("0.340");
});

it("toggles one wear series without hiding the other", async () => {
  const chart = host.querySelector('svg[aria-label^="Predicted wear history"]')!;
  const legend = host.querySelector('[aria-label="Toggle wear series"]')!;
  const diameter = legend.querySelector<HTMLButtonElement>("button")!;
  await act(async () => diameter.click());
  expect(diameter.getAttribute("aria-pressed")).toBe("false");
  expect(chart.querySelector('g[aria-label="Diameter wear"]')).toBeNull();
  expect(chart.querySelector('g[aria-label="Tool length wear"]')).not.toBeNull();
  await act(async () => diameter.click());
  expect(chart.querySelector('g[aria-label="Diameter wear"]')).not.toBeNull();
});

it("shows only the demo inspection result as one measurement with two axis markers", async () => {
  const chart = () => host.querySelector('svg[aria-label^="Predicted wear history"]')!;
  expect(chart().getAttribute("aria-label")).toContain("0 measured");
  await act(async () => root.render(React.createElement(ToolWearDashboard, {
    currentTool: "T25", wearDemo: { enabled: true, thresholds: { diameter: 0.1, length: 0.1 }, prediction: null, alerts: [],
      toolMeasurement: { machineId: "Makino_01", toolNo: "25", timestampUtc: new Date().toISOString(), diameter: 0.08, length: 0.03 } },
  })));
  expect(chart().getAttribute("aria-label")).toContain("1 measured");
  expect([...chart().querySelectorAll("title")].filter(title => title.textContent?.startsWith("Measured "))).toHaveLength(2);
});

it("refreshes the history on demand with the dates currently chosen, without polling", async () => {
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T06" })));
  await act(async () => vi.advanceTimersByTimeAsync(10));       // default range: the last 7 days up to today
  vi.mocked(historyState.reload).mockClear();
  const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh wear history"]')!;
  expect(button().textContent).toBe("Refresh");

  const end = host.querySelector<HTMLInputElement>('input[aria-label="Wear history end date"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setValue.call(end, "2026-11-03"); end.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button().click());
  expect(historyState.reload).toHaveBeenCalledTimes(1);
  const [, start, until] = historyCalls.at(-1)!;
  // Local calendar days: local midnight of the first day up to local midnight after the chosen end date (exclusive).
  expect(String(start)).toBe(new Date(2026, 9, 29).toISOString());
  expect(String(until)).toBe(new Date(2026, 10, 4).toISOString());

  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(historyState.reload).toHaveBeenCalledTimes(1);           // nothing else triggers a request

  await act(async () => { setValue.call(end, "2026-10-01"); end.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button().click());
  expect(host.textContent).toContain("Choose a start date on or before the end date.");
  expect(historyState.reload).toHaveBeenCalledTimes(1);           // an invalid range is not requested
});
