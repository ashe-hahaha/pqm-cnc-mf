"use client";
import { useEffect, useState } from "react";
import { toolKey } from "./toolNumber";

export type ControllerRow = {
  timestamp: string; tool_no?: number | string | null;
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
export function useControllerData(keepToolSnapshots = false, onSamples?: (rows: ControllerRow[], receivedAt: string, machine: string) => void) {
  const [rows, setRows] = useState<ControllerRow[]>([]);
  const [latestByTool, setLatestByTool] = useState<Record<string, ControllerRow & { receivedAt: string }>>({});
  const [status, setStatus] = useState("connecting");
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000";
    const machine = process.env.NEXT_PUBLIC_SIGNALS_MACHINE_ID;
    const source = new EventSource(`${base.replace(/\/$/, "")}/api/signals/stream${machine ? `?machine_id=${encodeURIComponent(machine)}` : ""}`);
    source.addEventListener("signals", event => {
      const receivedAt = new Date().toISOString();
      const batch = JSON.parse((event as MessageEvent).data);
      const records: ControllerRow[] = (batch.process ?? []).slice().sort((a: ControllerRow, b: ControllerRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      setRows(records);
      if (records.length) onSamples?.(records, receivedAt, batch.machine_id ?? machine ?? "");
      if (keepToolSnapshots && records.length) setLatestByTool(previous => {
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
    });
    source.addEventListener("status", event => setStatus(JSON.parse((event as MessageEvent).data).state));
    source.onerror = () => setStatus("unavailable");
    return () => source.close();
  }, [keepToolSnapshots, onSamples]);
  return { rows, status, latestByTool };
}
