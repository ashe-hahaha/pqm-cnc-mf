"use client";
import { useCallback, useEffect, useState } from "react";
import { toolKey } from "./toolNumber";

export type WearPoint = {
  timestamp: string; timestampEpoch: number; toolNo: number | string | null;
  xWearMm: number | null; zWearMm: number | null; xSegment: number; zSegment: number;
};
export type WearHistory = {
  start: string | null; end: string | null; data: WearPoint[];
  totalPoints: number; downsampled: boolean; environment: string; machine_id: string;
  availableToolNos?: (string | number | null)[];
};

/**
 * Measured wear history. It is requested once when the parameters are first available, again whenever they change
 * (tool, date range, window), and on `reload()` (a manual refresh). There is no polling.
 */
export function useWearHistory(minutes: number, start?: string, end?: string, tool?: string, enabled = true) {
  const key = `${minutes}:${start ?? ""}:${end ?? ""}:${tool ?? ""}`;
  const [reloads, setReloads] = useState(0);
  const token = `${key}#${reloads}`;
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [state, setState] = useState<{ key: string; token: string; data: WearHistory | null; error: string | null }>({ key: "", token: "", data: null, error: null });
  const reload = useCallback(() => setReloads(count => count + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const machine = process.env.NEXT_PUBLIC_SIGNALS_MACHINE_ID;
    const params = new URLSearchParams({ window_minutes: String(minutes), limit: "2000" });
    if (machine) params.set("machine_id", machine);
    if (tool) params.set("tool_no", tool);
    if (start && end) { params.set("start", start); params.set("end", end); }
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${base}/api/tool-wear/history?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        const data: WearHistory = await response.json();
        if (!Array.isArray(data.data)) throw new Error("Invalid history response");
        if (active) {
          setState({ key, token, data, error: null });
          setDiscoveredTools(previous => [...new Set([...previous, ...(data.availableToolNos ?? []).map(toolKey)])]);
        }
      } catch (error) {
        // Keep the last successful data of the same query; a different query starts empty.
        if (active) setState(previous => ({ key, token, data: previous.key === key ? previous.data : null, error: error instanceof Error ? error.message : "History unavailable" }));
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [key, token, minutes, start, end, tool, enabled]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: current ? state.data === null && state.error === null : true,
    /** A request for the current parameters is still in flight. */
    fetching: enabled && (!current || state.token !== token),
    reload,
    discoveredTools,
  };
}
