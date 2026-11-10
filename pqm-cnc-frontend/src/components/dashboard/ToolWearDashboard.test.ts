// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolWearDashboard } from "./ToolWearDashboard";

vi.mock("@/lib/useToolImage", () => ({ useToolImage: () => ({ status: "connected", image: {
  captureId: "capture-167", machineId: "Makino_01", toolNo: "167", timestampUtc: "2026-11-03T09:20:20Z",
  imageUrl: "http://127.0.0.1:8000/api/tool-images/capture-167/image", inspectionResult: "Wear checked",
} }) }));

vi.mock("@/lib/useControllerData", () => ({
  useControllerData: () => ({ status: "live", latestByTool: { "30": { timestamp: "2026-10-29T00:00:00Z", tool_no: 30, xWearMm: 0.34, zWearMm: 0.19, xGeometryMm: 2, zGeometryMm: 10 } } }),
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
  expect(host.querySelector('svg[aria-label="Diameter wear history"]')).not.toBeNull();
  expect(host.querySelector('svg[aria-label="Tool length wear history"]')).not.toBeNull();
  expect(host.querySelectorAll('svg[aria-label$="wear history"] circle')).toHaveLength(4);
  const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Selected tool"]')!;
  expect([...picker.options].map(option => option.text)).toEqual(["T30", "T06", "T167", "Unknown tool"]);
  expect(picker.value).toBe("30");
  expect(host.textContent).not.toContain("mock");
  expect(host.querySelectorAll("[data-tool-block]")).toHaveLength(6);
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
  expect(host.querySelector('svg[aria-label="Diameter wear history"]')).not.toBeNull();
  historyState.error = null;
});

it("switches to another tool without showing the previous controller reading", async () => {
  const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Selected tool"]')!;
  await act(async () => {
    picker.value = "6";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("Diameter wear history · T06");
  expect(host.querySelector('[aria-label="Diameter wear health"]')?.textContent).not.toContain("0.340");
});
