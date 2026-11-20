// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LiveSignalScopes } from "./LiveSignalScopes";

vi.mock("@/lib/signalsLive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/signalsLive")>("@/lib/signalsLive");
  return { ...actual, useSignalsLive: () => actual.initialSignalsState("live"), signalsStore: { getSnapshot: () => actual.initialSignalsState("live") } };
});

it("shows four stacked charts in order and no channel dropdown", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(LiveSignalScopes)));
  expect(host.querySelector("select")).toBeNull();
  expect([...host.querySelectorAll("canvas")].map(c => c.getAttribute("aria-label"))).toEqual([
    "Vibration · X M4 envelope", "Vibration · Y M4 envelope", "Vibration · Z M4 envelope", "AE RMS M4 envelope"]);
  await act(async () => root.unmount());
});
