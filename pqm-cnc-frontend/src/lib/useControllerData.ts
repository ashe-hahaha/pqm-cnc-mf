"use client";
import { useEffect, useRef, useState } from "react";
import { signalsStore, useSignalsLive } from "./signalsLive";
import { toolKey } from "./toolNumber";

export type ControllerRow = {
  timestamp: string; fanuc_raw_id?: string | null; tool_no?: number | string | null; nc_line?: number | string | null;
  feed_rate?: number | null; spindle_speed?: number | null;
  AP?: number | null; AE?: number | null;
  xWearMm?: number | null; zWearMm?: number | null;
  xGeometryMm?: number | null; zGeometryMm?: number | null;
  tool_wear_x_mm?: number | null; tool_wear_z_mm?: number | null;
};
export function controllerOffset(row: ControllerRow | undefined, axis: "x" | "z") {
  const wear = row?.[axis === "x" ? "xWearMm" : "zWearMm"] ?? row?.[axis === "x" ? "tool_wear_x_mm" : "tool_wear_z_mm"];
  const geometry = row?.[axis === "x" ? "xGeometryMm" : "zGeometryMm"];
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return { wear: valid(wear) ? wear : null, geometry: valid(geometry) ? geometry : null,
    offset: valid(wear) && valid(geometry) ? wear + geometry : null };
}
/**
 * Controller rows from the shared live signals connection (see signalsLive.ts). `rows` is the trailing window, oldest
 * first. `onSamples` gets the rows of each frame (all of them first, then only the new or changed ones).
 */
export function useControllerData(keepToolSnapshots = false, onSamples?: (rows: ControllerRow[], receivedAt: string, machine: string) => void) {
  const { process: rows, status } = useSignalsLive();
  const [latestByTool, setLatestByTool] = useState<Record<string, ControllerRow & { receivedAt: string }>>({});
  const onSamplesRef = useRef(onSamples);
  useEffect(() => { onSamplesRef.current = onSamples; }, [onSamples]);
  useEffect(() => signalsStore.subscribeRows((records, receivedAt, machine) => {
    onSamplesRef.current?.(records, receivedAt, machine);
    if (keepToolSnapshots) setLatestByTool(previous => {
      const next = { ...previous };
      for (const record of records) {
        const key = toolKey(record.tool_no);
        const current = next[key];
        const timestamp = Date.parse(record.timestamp);
        const currentTimestamp = current ? Date.parse(current.timestamp) : -Infinity;
        if (timestamp >= currentTimestamp) {
          next[key] = { ...record, receivedAt: timestamp === currentTimestamp ? current.receivedAt : receivedAt };
        }
      }
      return next;
    });
  }), [keepToolSnapshots]);
  return { rows, status, latestByTool };
}
