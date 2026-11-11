"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Panel } from "./Panel";
import type { WearEvent } from "./WearEventLog";

type Values = { diameter: number; length: number };
type Prediction = Values & { machineId: string; toolNo: string; timestampUtc: string };
type WearAlert = {
  alertId: string;
  timestampUtc: string;
  metrics: (keyof Values)[];
  prediction: Prediction;
  thresholds: Values;
};
export type WearAlertSnapshot = {
  enabled: boolean;
  thresholds: Values;
  prediction: Prediction | null;
  alerts: WearAlert[];
};

const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const endpoint = `${base}/api/tool-wear/demo`;
const fields = ["diameter", "length"] as const;
const fieldStyle = "w-full rounded border border-[#314254] bg-[#0c1722] p-2 text-[#c6d7e4]";
const buttonStyle = "rounded border border-[#385064] px-3 py-2 text-xs text-[#a5d8fa] disabled:opacity-50";

export function useWearAlertDemo(onEvent?: (events: WearEvent[]) => void) {
  const [snapshot, setSnapshot] = useState<WearAlertSnapshot | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (response.ok) {
        const data: WearAlertSnapshot = await response.json();
        if (!signal?.aborted) setSnapshot(data);
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
    stream.addEventListener("wear_event", event => {
      onEvent?.([JSON.parse((event as MessageEvent).data) as WearEvent]);
    });
    const timer = window.setInterval(load, 5000);
    document.addEventListener("visibilitychange", load);
    load();
    return () => {
      request?.abort();
      stream.close();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refresh, onEvent]);
  return snapshot;
}

export function WearAlertForm({ snapshot, settings = false, bare = false }: { snapshot: WearAlertSnapshot | null; settings?: boolean; bare?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const prediction = snapshot?.prediction;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = { diameter: Number(form.get("diameter")), length: Number(form.get("length")) };
    const body = settings ? values : { ...values, toolNo: String(form.get("toolNo")).trim() };
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
      setMessage(settings ? "Thresholds saved." : result.alert ? "Prediction recorded. Alert triggered." : "Prediction recorded.");
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
            ? `${prediction.machineId} · Tool ${prediction.toolNo} · Diameter ${prediction.diameter} mm · Length ${prediction.length} mm · ${new Date(prediction.timestampUtc).toLocaleString()}`
            : "No mock prediction yet."}
        </p>
      )}
      <form className="mt-2 flex flex-wrap items-end gap-2 text-xs" onSubmit={submit}>
        {!settings && <label>Tool number<input className={fieldStyle} name="toolNo" defaultValue="167" required maxLength={64} /></label>}
        {fields.map(field => (
          <label key={`${field}:${settings ? snapshot?.thresholds[field] : "mock"}`}>
            {field === "diameter" ? "Diameter" : "Length"} {settings ? "threshold" : "prediction"} (mm)
            <input className={fieldStyle} name={field} type="number" min="0" step="any" required
              defaultValue={settings ? snapshot?.thresholds[field] ?? 999 : 0} />
          </label>
        ))}
        <button className={buttonStyle} disabled={busy || !snapshot?.enabled}>
          {settings ? "Save thresholds" : busy ? "Predicting…" : "Submit mock prediction"}
        </button>
      </form>
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
