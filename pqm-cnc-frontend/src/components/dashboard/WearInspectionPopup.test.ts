// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WearInspection } from "./WearAlertDemo";
import { WearInspectionPopup } from "./WearInspectionPopup";

const inspection = (over: Partial<WearInspection> = {}): WearInspection => ({
  alertId: "a-1", machineId: "Makino_01", toolNo: "25", status: "result_ready", confirmedAt: "2026-11-19T01:00:00Z",
  image: { captureId: "photo-1", receivedAt: "2026-11-19T01:01:00Z" },
  result: {
    timestampUtc: "2026-11-19T01:02:00Z", actual: { diameter: 0.08, length: 0.2 }, predicted: { diameter: 0.35, length: 0.18 },
    thresholds: { diameter: 0.1, length: 999 }, exceeded: [],
  },
  ...over,
});

it("shows wear with five decimals without threshold comparisons and asks for a second run", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onSecondRun = vi.fn(), onDismiss = vi.fn();
  const render = (value: WearInspection | null) => act(async () => root.render(React.createElement(WearInspectionPopup, { inspection: value, onSecondRun, onDismiss })));

  await render(null);
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  await render(inspection({ status: "awaiting_result", result: null }));  // still waiting for the controller
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  await render(inspection({ status: "awaiting_result", image: null }));  // wear arrived, image has not
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  await render(inspection({ result: null }));  // image alone opens the popup
  expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(host.textContent).toContain("Waiting for measurement");
  expect(host.textContent).toContain("Yes, rework");

  await render(inspection());
  const dialog = host.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("Laser inspection result");
  expect(dialog.textContent).toContain("T25");
  expect(dialog.textContent).toContain("Diameter wear");
  expect(dialog.textContent).toContain("0.08000 mm");
  expect(dialog.textContent).toContain("0.20000 mm");
  expect(dialog.textContent).toContain("Predicted 0.35000 mm");
  expect(dialog.textContent).toContain("Predicted 0.18000 mm");
  expect(dialog.textContent).not.toMatch(/threshold/i);
  expect(dialog.textContent).toContain("Do you want to perform rework?");

  await render(inspection({ result: { ...inspection().result!, actual: { diameter: 0.234567, length: 0.2 }, exceeded: ["diameter"] } }));
  expect(host.textContent).toContain("0.23457 mm");
  expect(host.textContent).not.toMatch(/threshold/i);

  const buttons = [...host.querySelectorAll("button")];
  await act(async () => buttons.find(b => b.textContent === "Yes, rework")!.click());
  expect(onSecondRun).toHaveBeenCalledWith("a-1");
  await act(async () => buttons.find(b => b.textContent === "Later")!.click());
  expect(onDismiss).toHaveBeenCalledWith("a-1");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(onDismiss).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
});
