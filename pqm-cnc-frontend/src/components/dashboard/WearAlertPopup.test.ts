// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WearAlertPopup } from "./WearAlertPopup";

const alert = (id: string) => ({
  alertId: id, timestampUtc: "2026-11-11T00:01:00Z", metrics: ["diameter" as const],
  thresholds: { diameter: 0.1, length: 999 },
  prediction: { machineId: "Makino_01", toolNo: "25", timestampUtc: "2026-11-11T00:01:00Z", index: 10, diameter: 0.35, length: 0.18 },
});

it("shows the newest alert centered, reveals details, and confirms or dismisses", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onConfirm = vi.fn(), onDismiss = vi.fn();
  const render = (alerts: ReturnType<typeof alert>[]) => act(async () => root.render(React.createElement(WearAlertPopup, {
    alerts, destinations: ["kafka", "temi"], onConfirm, onDismiss })));

  await render([]);
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();

  await render([alert("a-1"), alert("a-2")]);
  const dialog = host.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("T25");
  expect(dialog.textContent).toContain("2 new alerts");
  expect(dialog.textContent).toContain("0.35 mm");
  expect(dialog.textContent).not.toContain("Alert ID");

  const buttons = [...dialog.querySelectorAll("button")];
  await act(async () => buttons.find(b => b.textContent === "Details")!.click());
  expect(dialog.textContent).toContain("Kafka, Temi");
  expect(dialog.textContent).toContain("a-2");

  await act(async () => buttons.find(b => b.textContent?.startsWith("Confirm"))!.click());
  expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => buttons.find(b => b.textContent === "Dismiss")!.click());
  expect(onDismiss).toHaveBeenCalledOnce();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(onDismiss).toHaveBeenCalledTimes(2);
});
