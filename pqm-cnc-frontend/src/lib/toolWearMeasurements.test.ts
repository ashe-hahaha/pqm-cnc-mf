import { expect, it } from "vitest";
import { toolWearMeasurements } from "./toolWearMeasurements";
import type { WearPrediction } from "@/components/dashboard/WearAlertDemo";

it("shows historical markers only with their prediction, then appends inspection without replacing them", () => {
  const points: WearPrediction[] = Array.from({ length: 9 }, (_, i) => ({
    index: i + 1, timestampUtc: `2026-11-26T01:0${i}:00Z`, machineId: "Makino_01", toolNo: "25",
    diameter: 0.12, length: 0.005,
    measured: [3, 6, 9].includes(i + 1) ? { diameter: 0.11999, length: 0.00499 } : null,
  }));
  expect(toolWearMeasurements(points.slice(0, 2))).toEqual([]);
  const historical = toolWearMeasurements(points);
  expect(historical.map(p => p.t)).toEqual([2, 5, 8].map(i => Date.parse(points[i].timestampUtc)));
  const extra = { timestampUtc: "2026-11-26T02:00:00Z", machineId: "Makino_01", toolNo: "25", diameter: 0.12, length: 0.0048 };
  expect(toolWearMeasurements(points, extra)).toEqual([...historical, { t: Date.parse(extra.timestampUtc), diameter: 0.12, length: 0.0048 }]);
});
