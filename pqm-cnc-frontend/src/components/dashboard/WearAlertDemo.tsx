"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Panel } from "./Panel";
import type { WearEvent } from "./WearEventLog";

type Values = { diameter: number; length: number };
export type WearPrediction = Values & { machineId: string; toolNo: string; timestampUtc: string; index?: number; balloonId?: string; quality?: number };
type Prediction = WearPrediction;
export type ToolWearAlert = {
  kind?: "tool_wear";
  alertId: string;
  timestampUtc: string;
  metrics: (keyof Values)[];
  prediction: Prediction;
  thresholds: Values;
};
/** Predicted quality value left the balloon's tolerance band. */
type QualityAlert = {
  kind: "quality";
  alertId: string;
  timestampUtc: string;
  balloonId: string;
  value: number;
  side: "upper" | "lower";
  limit: number;
  prediction: Prediction;
};
export type WearAlert = ToolWearAlert | QualityAlert;
export type QualitySpec = { nominal: number; upperTol: number; lowerTol: number };
/** Controller NC line watch: the backend starts a prediction when the value changes to `triggerValue`. */
export type NcWatch = { field: string; triggerValue: string; running: boolean; value: string | null; lastTriggerAt: string | null };
export type WearAlertSnapshot = {
  enabled: boolean;
  thresholds: Values;
  prediction: Prediction | null;
  /** Latest predictions for the fixed tool (oldest first, sliding window). */
  history?: WearPrediction[];
  /** Fixed prediction values that each trigger cycles through. */
  series?: { index: number; diameter: number; length: number; quality?: number }[];
  /** Balloon the quality value of each prediction belongs to. */
  qualityBalloonId?: string;
  /** Tolerance of the quality balloon, stored by the backend (used by every trigger). */
  qualitySpec?: QualitySpec;
  ncWatch?: NcWatch;
  /** 1-based index the next automatic trigger will use. */
  nextIndex?: number;
  alerts: WearAlert[];
  /** Notification targets the backend sends tool wear alerts to (e.g. "kafka", "temi"). */
  destinations?: string[];
  /** Notifications queued but not delivered yet (a growing number means sends are failing). */
  pendingNotifications?: number;
  /** Recent persisted events, oldest first. */
  events?: WearEvent[];
};

/** Thresholds at or above this are the backend default ("not set"): no tool wear alert can fire. */
export const THRESHOLD_NOT_SET = 999;
const REFRESH_EVENT = "pqm:wear-refresh";
/** Re-read the snapshot now instead of waiting for the next poll. */
export function requestWearRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}
const RESET_EVENT = "pqm:wear-reset";
/** Tell this page the demo was reset, so locally held events are dropped even if the live stream is down. */
function requestWearReset() {
  window.dispatchEvent(new Event(RESET_EVENT));
}

const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const endpoint = `${base}/api/tool-wear/demo`;
const fields = ["diameter", "length"] as const;
const fieldStyle = "w-full rounded border border-[#314254] bg-[#0c1722] p-2 text-[#c6d7e4]";
const buttonStyle = "rounded border border-[#385064] px-3 py-2 text-xs text-[#a5d8fa] disabled:opacity-50";

/** Store the quality balloon's tolerance on the backend; returns false when it could not be saved. */
export async function saveQualitySpec(spec: QualitySpec): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/quality-spec`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
    });
    requestWearRefresh();
    return response.ok;
  } catch {
    return false;
  }
}

export function useWearAlertDemo(onEvent?: (events: WearEvent[]) => void, onReset?: () => void) {
  const [snapshot, setSnapshot] = useState<WearAlertSnapshot | null>(null);
  const onEventRef = useRef(onEvent);
  const onResetRef = useRef(onReset);
  useEffect(() => { onEventRef.current = onEvent; onResetRef.current = onReset; }, [onEvent, onReset]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (response.ok) {
        const data: WearAlertSnapshot = await response.json();
        if (!signal?.aborted) {
          setSnapshot(data);
          if (data.events?.length) onEventRef.current?.(data.events);
        }
      }
    } catch {
      // Keep the last successful snapshot while the backend is unavailable.
    }
  }, []);
  useEffect(() => {
    let request: AbortController | undefined;
    const load = () => {
      if (document.hidden) return;
      request?.abort();
      request = new AbortController();
      void refresh(request.signal);
    };
    const stream = new EventSource(`${endpoint}/events`);
    stream.addEventListener("updated", load);
    stream.addEventListener("reset", () => onResetRef.current?.());
    stream.addEventListener("wear_event", event => {
      onEventRef.current?.([JSON.parse((event as MessageEvent).data) as WearEvent]);
    });
    const timer = window.setInterval(load, 5000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(REFRESH_EVENT, load);
    const handleReset = () => onResetRef.current?.();
    window.addEventListener(RESET_EVENT, handleReset);
    load();
    return () => {
      request?.abort();
      stream.close();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener(REFRESH_EVENT, load);
      window.removeEventListener(RESET_EVENT, handleReset);
    };
  }, [refresh]);
  return snapshot;
}

export function WearAlertForm({ snapshot, settings = false, bare = false }: {
  snapshot: WearAlertSnapshot | null; settings?: boolean; bare?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("auto");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);
  const prediction = snapshot?.prediction;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = settings
      ? { diameter: Number(form.get("diameter")), length: Number(form.get("length")) }
      : (selected === "auto" ? {} : { index: Number(selected) });
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/${settings ? "thresholds" : "prediction"}`, {
        method: settings ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json();
      if (!settings) setSelected("auto");
      requestWearRefresh();
      setMessage(settings ? "Thresholds saved." : result.alert || result.qualityAlert ? "Prediction recorded. Alert triggered." : "Prediction recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/reset`, { method: "POST" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setSelected("auto");
      requestWearReset();
      requestWearRefresh();
      setMessage("Reset to the first 8 predictions.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      {!settings && (
        <p className="text-xs text-[#a5bdd0]">
          {prediction
            ? `${prediction.machineId} · Tool ${prediction.toolNo}${prediction.index ? ` · #${prediction.index}` : ""} · Diameter ${prediction.diameter} mm · Length ${prediction.length} mm · ${new Date(prediction.timestampUtc).toLocaleString()}`
            : "No mock prediction yet."}
        </p>
      )}
      <form className="mt-2 flex flex-wrap items-end gap-2 text-xs" onSubmit={submit}>
        {settings ? fields.map(field => (
          <label key={`${field}:${snapshot?.thresholds[field]}`}>
            {field === "diameter" ? "Diameter" : "Length"} threshold (mm)
            <input className={fieldStyle} name={field} type="number" min="0" step="any" required
              defaultValue={snapshot?.thresholds[field] ?? 999} />
          </label>
        )) : (
          <label className="min-w-0 flex-1">Next value
            <select className={fieldStyle} value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="auto">Auto{snapshot?.nextIndex ? ` (next: #${snapshot.nextIndex})` : ""}</option>
              {(snapshot?.series ?? []).map(item => (
                <option key={item.index} value={item.index}>
                  #{item.index} · Diameter {item.diameter} · Length {item.length} · B1 {item.quality ?? "–"} mm
                </option>
              ))}
            </select>
          </label>
        )}
        <button className={buttonStyle} disabled={busy || !snapshot?.enabled}>
          {settings ? "Save thresholds" : busy ? "Predicting…" : "Trigger prediction"}
        </button>
        {!settings && (
          <button type="button" onClick={reset} disabled={busy || !snapshot?.enabled}
            title="Clear alerts and events and keep only the first 8 predictions"
            className={`${buttonStyle} ${confirmReset ? "border-amber-500/60 text-amber-300" : ""}`}>
            {confirmReset ? "Confirm reset?" : "Reset to first 8"}
          </button>
        )}
      </form>
      {!settings && snapshot && snapshot.enabled && fields.every(field => snapshot.thresholds[field] >= THRESHOLD_NOT_SET) && (
        <p className="mt-2 text-xs text-amber-400">
          Tool wear thresholds are not set — no tool wear alert will fire. Set them with ⚙ on the Tool Wear page.
        </p>
      )}
      {!settings && snapshot?.destinations && (
        <p className="mt-2 text-xs text-[#8296a8]">
          Notifications: {snapshot.destinations.length ? snapshot.destinations.map(name => name === "kafka" ? "Kafka" : name === "temi" ? "Temi" : name).join(", ") : "none enabled"}
          {snapshot.pendingNotifications ? ` · ${snapshot.pendingNotifications} pending` : ""}
        </p>
      )}
      {!settings && snapshot?.ncWatch && (
        <p className="mt-2 text-xs text-[#8296a8]" data-testid="nc-watch">
          NC line watch: {snapshot.ncWatch.running ? "running" : "waiting for the signal stream"}
          {` · ${snapshot.ncWatch.field} = ${snapshot.ncWatch.value ?? "–"} · auto-trigger when it becomes ${snapshot.ncWatch.triggerValue}`}
          {snapshot.ncWatch.lastTriggerAt ? ` · last auto trigger ${new Date(snapshot.ncWatch.lastTriggerAt).toLocaleTimeString()}` : ""}
        </p>
      )}
      {snapshot && !snapshot.enabled && <p className="mt-2 text-xs text-[#a5bdd0]">Mock prediction controls are disabled on the server.</p>}
      <p role="status" className="mt-2 text-xs text-[#a5bdd0]">{message}</p>
    </>
  );
  return settings || bare ? content : <Panel title="Mock tool wear prediction">{content}</Panel>;
}

/** Header icon button that opens the mock prediction form in a popover. */
export function WearAlertPopover({ snapshot }: { snapshot: WearAlertSnapshot | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const alerting = (snapshot?.alerts.length ?? 0) > 0;
  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label="Mock tool wear prediction" title="Mock tool wear prediction"
        aria-expanded={open} aria-controls="wear-mock-popover" onClick={() => setOpen(v => !v)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
          open ? "border-[#3d8fd1]/50 bg-[#3d8fd1]/15 text-[#7eb6e8]"
               : "border-[#243141] bg-[#121a24] text-[#8fa3b5] hover:border-[#3d8fd1]/40 hover:text-[#7eb6e8]"}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3" />
          <path d="M7.5 15h9" />
        </svg>
        {alerting && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />}
      </button>
      {open && (
        <div id="wear-mock-popover" role="dialog" aria-label="Mock tool wear prediction"
          className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,420px)] rounded-xl border border-[#243141] bg-[#121a24] p-3.5 shadow-xl shadow-black/40">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#8fa3b5]">Mock tool wear prediction</h2>
          <WearAlertForm snapshot={snapshot} bare />
        </div>
      )}
    </div>
  );
}
