"use client";
import { useEffect, useState } from "react";
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

export function useWearHistory(minutes: number, start?: string, end?: string, tool?: string, enabled = true) {
  const key = `${minutes}:${start ?? ""}:${end ?? ""}:${tool ?? ""}`;
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [state, setState] = useState<{ key: string; data: WearHistory | null; error: string | null }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const machine = process.env.NEXT_PUBLIC_SIGNALS_MACHINE_ID;
    const params = new URLSearchParams({ window_minutes: String(minutes), limit: "2000" });
    if (machine) params.set("machine_id", machine);
    if (tool) params.set("tool_no", tool);
    if (start && end) { params.set("start", start); params.set("end", end); }
    const controller = new AbortController();
    let active = true, running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      if (!active || running || document.hidden) return;
      running = true;
      try {
        const response = await fetch(`${base}/api/tool-wear/history?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        const data: WearHistory = await response.json();
        if (!Array.isArray(data.data)) throw new Error("Invalid history response");
        if (active) {
          setState({ key, data, error: null });
          setDiscoveredTools(previous => [...new Set([...previous, ...(data.availableToolNos ?? []).map(toolKey)])]);
        }
      } catch (error) {
        if (active) setState(previous => ({ key, data: previous.key === key ? previous.data : null, error: error instanceof Error ? error.message : "History unavailable" }));
      } finally {
        running = false;
        if (active && !document.hidden) timer = setTimeout(load, 5000);
      }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void load(); };
    void load();
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [key, minutes, start, end, tool, enabled]);
  return state.key === key ? { data: state.data, error: state.error, loading: state.data === null && state.error === null, discoveredTools } : { data: null, error: null, loading: true, discoveredTools };
}
