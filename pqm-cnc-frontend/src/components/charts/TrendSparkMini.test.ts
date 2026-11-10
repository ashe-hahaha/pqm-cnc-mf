// @vitest-environment jsdom
import { createElement, act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TrendSparkMini } from "./TrendSparkMini";

it("hydrates server-rendered SVG point titles without a mismatch", async () => {
  const element = createElement(TrendSparkMini, { series: [10, 12, 11], label: "Feedrate" });
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.appendChild(container);
  const errors: unknown[] = [];
  const root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error) });
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(errors).toEqual([]);
    expect(container.querySelector("circle title")?.textContent).toBe("Feedrate: 10.0");
  } finally {
    root.unmount();
    container.remove();
  }
});
