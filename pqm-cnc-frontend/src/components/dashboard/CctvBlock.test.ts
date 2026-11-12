// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CctvBlock } from "./CctvBlock";

let root: Root;
let host: HTMLDivElement;
const jpeg = () => ({ ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }),
  headers: new Headers({ "X-Captured-At": new Date().toISOString() }) });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  URL.createObjectURL = vi.fn(() => "blob:frame");
  URL.revokeObjectURL = vi.fn();
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("shows the picture, keeps it when a refresh fails, and polls one request at a time", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(jpeg()).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(jpeg());
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(React.createElement(CctvBlock)));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:frame");
  expect(host.querySelector("[role=status]")?.textContent).toBe("Live");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/cctv/snapshot");

  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(host.querySelector("[role=status]")?.textContent).toBe("Unavailable · retrying");
  expect(host.querySelector("img")).not.toBeNull();  // the last picture stays visible

  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(host.querySelector("[role=status]")?.textContent).toBe("Live");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
