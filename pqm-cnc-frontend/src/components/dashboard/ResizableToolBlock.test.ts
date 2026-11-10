// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResizableToolBlock } from "./ResizableToolBlock";

let host: HTMLDivElement;
let root: Root;
let report: (entries: { contentRect: { width: number; height: number } }[]) => void;
beforeEach(() => {
  localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: typeof report) { report = callback; }
    observe() { report([{ contentRect: { width: 320, height: 200 } }]); }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("persists independent width and height and restores them", async () => {
  await act(async () => root.render(React.createElement(ResizableToolBlock, { id: "diameter-trend", width: 320, height: 200, children: "Chart" })));
  await act(async () => report([{ contentRect: { width: 610, height: 420 } }]));
  expect(JSON.parse(localStorage.getItem("pqm.toolWear.block:diameter-trend")!)).toEqual({ width: 610, height: 420 });
  expect((host.firstElementChild as HTMLElement).style.height).toBe("420px");
  expect((host.firstElementChild as HTMLElement).style.resize).toBe("both");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ResizableToolBlock, { id: "diameter-trend", width: 320, height: 200, locked: true, children: "Chart" })));
  expect((host.firstElementChild as HTMLElement).style.height).toBe("420px");
  expect((host.firstElementChild as HTMLElement).style.resize).toBe("none");
});
