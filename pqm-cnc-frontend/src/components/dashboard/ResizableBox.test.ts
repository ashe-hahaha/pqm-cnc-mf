// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ResizableBox } from "./ResizableBox";
import { ToolWearTrend } from "./ToolWearTrend";
import { readDashboardLayout } from "@/lib/dashboardLayout";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function Harness({ initial = 280, locked = false }) {
  const [height, setHeight] = useState(initial);
  return React.createElement(ResizableBox, {
    id: "toolWearTrend", height, minHeight: 180, locked,
    onHeightChange: setHeight, children: React.createElement(ToolWearTrend),
  });
}

it("resizes the actual tool wear panel in both directions and stops on pointerup", async () => {
  await act(async () => root.render(React.createElement(Harness)));
  const box = host.querySelector<HTMLElement>("#toolWearTrend")!;
  const handle = host.querySelector('[role="separator"]')!;
  await act(async () => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 300 })));
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 420 })));
  expect(box.style.height).toBe("400px");
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 240 })));
  expect(box.style.height).toBe("220px");
  await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientY: 600 })));
  expect(box.style.height).toBe("220px");
  expect(host.querySelector('svg[role="img"]')).not.toBeNull();
});

it("recovers invalid heights and supports keyboard resizing", async () => {
  localStorage.setItem("pqm.ops.dashboardLayout", JSON.stringify({ heights: { toolWearTrend: null } }));
  expect(readDashboardLayout().heights.toolWearTrend).toBe(280);
  await act(async () => root.render(React.createElement(Harness, { initial: NaN })));
  const box = host.querySelector<HTMLElement>("#toolWearTrend")!;
  expect(box.style.height).toBe("280px");
  await act(async () => host.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(box.style.height).toBe("300px");
});

it("does not expose a drag handle when the layout is locked", async () => {
  await act(async () => root.render(React.createElement(Harness, { locked: true })));
  expect(host.querySelector('[role="separator"]')).toBeNull();
});
