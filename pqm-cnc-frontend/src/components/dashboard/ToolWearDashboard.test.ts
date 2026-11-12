// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolWearDashboard } from "./ToolWearDashboard";

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
  useControllerData: () => ({ status: "live", latestByTool: { "25": { timestamp: "2026-10-29T00:00:00Z", tool_no: 25, receivedAt: "2026-10-29T00:00:01Z", xWearMm: 0.34, zWearMm: 0.19, xGeometryMm: 2, zGeometryMm: 10 } } }),
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
}, error: null as string | null, loading: false, discoveredTools: ["167", "unknown"] }));
vi.mock("@/lib/useWearHistory", () => ({ useWearHistory: () => historyState }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T06" })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("shows both health outputs and separate trend charts without offset or feedback controls", () => {
  expect(host.querySelector('[aria-label="Diameter wear health"]')?.textContent).toContain("0.340");
  expect(host.querySelector('[aria-label="Tool length wear health"]')?.textContent).toContain("0.190");
  expect(host.textContent).toContain("Offset 2.340 mm");
  expect(host.textContent).toContain("Offset 10.190 mm");
  expect(host.querySelector('svg[aria-label="Tool wear history"]')).not.toBeNull();
  expect(host.querySelectorAll('svg[aria-label="Tool wear history"] circle')).toHaveLength(4);
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
  expect(historyBlock?.querySelectorAll('svg[aria-label="Tool wear history"]')).toHaveLength(1);
  expect(host.textContent).not.toContain("Apply offset");
  expect(host.textContent).not.toContain("Machine feedback");
  expect(host.querySelector("#wear-dimension")).toBeNull();
  expect(host.textContent).not.toContain("Tool wear simulation");
  expect(host.querySelector("#wear-scenario")).toBeNull();
});

it("shows history errors while retaining the last successful charts", async () => {
  historyState.error = "History request failed (502)";
  await act(async () => root.render(React.createElement(ToolWearDashboard, { currentTool: "T06" })));
  expect(host.textContent).toContain("Showing last successful data");
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

it("shows the controller's measured values as markers on the predicted wear history", () => {
  const chart = host.querySelector('svg[aria-label^="Predicted wear history"]')!;
  expect(chart.getAttribute("aria-label")).toContain("2 measured");
  // Two history records, each with a diameter (X) and a length (Z) value.
  expect([...chart.querySelectorAll("title")].filter(title => title.textContent?.startsWith("Measured "))).toHaveLength(4);
});
