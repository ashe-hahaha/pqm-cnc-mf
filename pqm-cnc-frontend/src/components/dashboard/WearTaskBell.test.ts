// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WearTaskBell } from "./WearTaskBell";
import type { WearTask } from "./WearAlertDemo";

it("lists deferred tasks, reopens the selected one, and removes completed tasks", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), onOpen = vi.fn();
  const task: WearTask = { id: "rework:1", kind: "rework", toolNo: "25", timestampUtc: "2026-11-26T00:00:00Z", deferred: true };
  const render = (tasks: WearTask[]) => act(async () => root.render(React.createElement(WearTaskBell, { tasks, onOpen })));
  await render([task]);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pending tasks (1)"]')!.click());
  const panel = host.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain("T25 · Confirm rework");
  expect(panel.textContent).toContain("Deferred");
  await act(async () => panel.querySelector<HTMLButtonElement>("li button")!.click());
  expect(onOpen).toHaveBeenCalledWith(task);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await render([]);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Pending tasks (0)"]')!.click());
  expect(host.textContent).toContain("No pending tasks");
  await act(async () => root.unmount()); host.remove();
});
