// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WearInspection } from "./WearAlertDemo";
import { WearInspectionPopup } from "./WearInspectionPopup";

const inspection = (over: Partial<WearInspection> = {}): WearInspection => ({
  alertId: "a-1", machineId: "Makino_01", toolNo: "25", status: "result_ready", confirmedAt: "2026-11-19T01:00:00Z",
  result: {
    timestampUtc: "2026-11-19T01:02:00Z", actual: { diameter: 0.08, length: 0.2 }, predicted: { diameter: 0.35, length: 0.18 },
    thresholds: { diameter: 0.1, length: 999 }, exceeded: [],
  },
  ...over,
});

it("shows the inspection result against prediction and threshold and asks for a second run", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onSecondRun = vi.fn(), onDismiss = vi.fn();
  const render = (value: WearInspection | null) => act(async () => root.render(React.createElement(WearInspectionPopup, { inspection: value, onSecondRun, onDismiss })));

  await render(null);
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  await render(inspection({ status: "awaiting_result", result: null }));  // still waiting for the controller
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();

  await render(inspection());
  const dialog = host.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("Laser inspection result");
  expect(dialog.textContent).toContain("T25");
  expect(dialog.textContent).toContain("Diameter wear");
  expect(dialog.textContent).toContain("0.08 mm");
  expect(dialog.textContent).toContain("Predicted 0.35 mm · Threshold 0.1 mm");
  expect(dialog.textContent).toContain("Within threshold");
  expect(dialog.textContent).toContain("Wear is back within the threshold.");
  expect(dialog.textContent).toContain("Threshold not set");  // 999 is the backend default for "not set": no verdict for length
  expect(dialog.textContent).toContain("Do you want to perform a second run?");

  await render(inspection({ result: { ...inspection().result!, actual: { diameter: 0.2, length: 0.2 }, exceeded: ["diameter"] } }));
  expect(host.textContent).toContain("Still above threshold");
  expect(host.textContent).toContain("Wear is still above the threshold.");

  const buttons = [...host.querySelectorAll("button")];
  await act(async () => buttons.find(b => b.textContent === "Yes, second run")!.click());
  expect(onSecondRun).toHaveBeenCalledWith("a-1");
  await act(async () => buttons.find(b => b.textContent === "Not now")!.click());
  expect(onDismiss).toHaveBeenCalledWith("a-1");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(onDismiss).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
});
