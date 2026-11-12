// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveStreamUrl, useMseStream } from "./useMseStream";

class FakeSourceBuffer extends EventTarget {
  updating = false; mode = ""; buffered = { length: 0 };
  appended: number[] = [];
  appendBuffer(data: Uint8Array) { this.appended.push(data.byteLength); }
}
class FakeMediaSource extends EventTarget {
  static isTypeSupported = (type: string) => type.includes("avc1.640029");
  readyState = "open"; buffers: FakeSourceBuffer[] = [];
  addSourceBuffer() { const sb = new FakeSourceBuffer(); this.buffers.push(sb); return sb; }
}
class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = ""; sent: string[] = []; closed = false;
  onopen: (() => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null; onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
}

let root: Root;
let host: HTMLDivElement;
let sources: FakeMediaSource[];
let liveFlag: boolean;
function Probe({ url }: { url?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  liveFlag = useMseStream(url, ref);
  return React.createElement("video", { ref });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  FakeSocket.all = []; sources = []; liveFlag = false;
  vi.stubGlobal("MediaSource", class extends FakeMediaSource {
    static isTypeSupported = FakeMediaSource.isTypeSupported;
    constructor() { super(); sources.push(this); }
  });
  vi.stubGlobal("WebSocket", FakeSocket);
  URL.createObjectURL = vi.fn(() => "blob:ms"); URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("does nothing without a stream url", async () => {
  await act(async () => root.render(React.createElement(Probe)));
  expect(FakeSocket.all).toHaveLength(0);
  expect(liveFlag).toBe(false);
});

it("negotiates codecs, plays the data and reconnects when the stream goes silent", async () => {
  await act(async () => root.render(React.createElement(Probe, { url: "ws://x/api/ws?src=v61" })));
  const socket = FakeSocket.all[0];
  expect(socket.url).toBe("ws://x/api/ws?src=v61");
  await act(async () => { sources[0].dispatchEvent(new Event("sourceopen")); socket.onopen?.(); });
  expect(JSON.parse(socket.sent[0])).toEqual({ type: "mse", value: "avc1.640029" });

  await act(async () => socket.onmessage?.({ data: JSON.stringify({ type: "mse", value: 'video/mp4; codecs="avc1.4d0033"' }) }));
  await act(async () => socket.onmessage?.({ data: new ArrayBuffer(10) }));
  expect(sources[0].buffers[0].appended).toEqual([10]);
  expect(liveFlag).toBe(true);

  await act(async () => { await vi.advanceTimersByTimeAsync(7000); });  // no more data
  expect(liveFlag).toBe(false);
  expect(socket.closed).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(FakeSocket.all).toHaveLength(2);  // reconnected
});

it("turns a same-origin path into a ws url and keeps full urls", () => {
  expect(resolveStreamUrl("/cctv/ws")).toBe(`ws://${location.host}/cctv/ws`);
  expect(resolveStreamUrl("ws://localhost:1984/api/ws?src=v61")).toBe("ws://localhost:1984/api/ws?src=v61");
});
