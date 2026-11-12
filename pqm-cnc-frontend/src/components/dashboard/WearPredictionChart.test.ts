// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { WearPredictionChart } from "./WearPredictionChart";

const point = (index: number, diameter: number, length: number, t: string) => ({
  machineId: "m", toolNo: "25", timestampUtc: t, index, diameter, length });

it("draws predicted lines, red points over threshold, threshold lines and measured markers", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(WearPredictionChart, {
    points: [point(1, 0.05, 0.02, "2026-11-11T00:00:00Z"), point(2, 0.35, 0.18, "2026-11-11T00:01:00Z")],
    thresholds: { diameter: 0.1, length: 999 },
    measured: [{ t: Date.parse("2026-11-11T00:00:30Z"), diameter: 0.2, length: null }],
    xMode: "time",
  })));
  const svg = host.querySelector('svg[role="img"]')!;
  expect(svg.textContent).toContain("D limit 0.100 mm");
  expect(svg.textContent).not.toContain("L limit");
  expect(host.textContent).toContain("L threshold not set");
  expect(svg.querySelectorAll('circle[fill="#fb7185"]')).toHaveLength(1);
  expect([...svg.querySelectorAll("title")].filter(t => t.textContent?.startsWith("Measured "))).toHaveLength(1);
  const diameter = host.querySelector<HTMLButtonElement>('[aria-label="Toggle wear series"] button')!;
  await act(async () => diameter.click());
  expect(svg.querySelector('g[aria-label="Diameter wear"]')).toBeNull();
  expect(svg.querySelector('g[aria-label="Tool length wear"]')).not.toBeNull();
});
