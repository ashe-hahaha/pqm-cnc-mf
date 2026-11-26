import type { WearPrediction, WearAlertSnapshot } from "@/components/dashboard/WearAlertDemo";

/** Historical markers follow their own prediction's timestamp; inspection is an extra measurement. */
export function toolWearMeasurements(points: readonly WearPrediction[], inspection?: WearAlertSnapshot["toolMeasurement"]) {
  const measured = points.flatMap(point => point.measured
    ? [{ t: Date.parse(point.timestampUtc), diameter: point.measured.diameter, length: point.measured.length }] : []);
  if (inspection) measured.push({ t: Date.parse(inspection.timestampUtc), diameter: inspection.diameter, length: inspection.length });
  return measured;
}
