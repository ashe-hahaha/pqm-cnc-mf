import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WearHistoryChart } from "./WearHistoryChart";
import type { WearHistory } from "@/lib/useWearHistory";

it("plots unknown tool samples and breaks the line across missing wear values", () => {
  const history: WearHistory = { start: null, end: null, machine_id: "M1", environment: "real", downsampled: false, totalPoints: 3,
    data: [-0.2, null, 0].map((value, i) => ({ timestampEpoch: 1000 * i, timestamp: new Date(1000 * i).toISOString(), toolNo: null,
      xWearMm: value, zWearMm: value, xSegment: i === 0 ? 0 : 1, zSegment: i === 0 ? 0 : 1 })) };
  const html = renderToStaticMarkup(createElement(WearHistoryChart, { history, axis: "x", label: "Diameter wear", color: "blue" }));
  expect(html.match(/<circle /g)).toHaveLength(2);
  expect(html).toContain("Tool unknown");
  const path = html.match(/<path d="([^"]*)"/)?.[1] ?? "";
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path).not.toContain("L");
});
