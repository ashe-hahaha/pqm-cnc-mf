// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolImageBlock } from "./ToolImageBlock";

class FakeSource extends EventTarget {
  static instances: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { super(); FakeSource.instances.push(this); }
  send(event: string, data: unknown) { this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) })); }
}
let root: Root;
let host: HTMLDivElement;
const image = (sequence: number, tool = "167") => ({
  captureId: `00000000-0000-0000-0000-${String(sequence).padStart(12, "0")}`,
  machineId: "Makino_01", toolNo: tool, timestampUtc: "2026-11-03T09:20:20Z",
  receivedSequence: sequence, receivedAt: "2026-11-04T00:00:00Z", inspectionResult: "Checked",
  imageUrl: `/api/tool-images/00000000-0000-0000-0000-${String(sequence).padStart(12, "0")}/image`,
});
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  FakeSource.instances = [];
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ image: null, status: { state: "connected" } }) }));
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ToolImageBlock)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows any tool capture, replaces it on SSE, and ignores older snapshots", async () => {
  const source = FakeSource.instances[0];
  expect(host.textContent).toContain("Waiting for microscope image");
  await act(async () => source.send("image", image(1)));
  expect(host.querySelector("img")?.alt).toContain("Tool 167");
  await act(async () => source.send("image", image(2, "9")));
  expect(host.querySelector("img")?.alt).toContain("Tool 9");
  await act(async () => source.send("image", image(1)));
  expect(host.querySelector("img")?.alt).toContain("Tool 9");
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("retains the last image during disconnect and refreshes latest on reconnect", async () => {
  const source = FakeSource.instances[0];
  await act(async () => source.send("image", image(1)));
  await act(async () => source.onerror?.());
  expect(host.textContent).toContain("Connection lost");
  expect(host.querySelector("img")).not.toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ image: image(3), status: { state: "connected" } }) } as Response);
  await act(async () => source.onopen?.());
  expect(host.querySelector("img")?.src).toContain(image(3).imageUrl);
  expect(host.textContent).toContain("Waiting for new captures");
});
