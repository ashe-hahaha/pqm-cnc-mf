"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Panel } from "./Panel";

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

export function useWearAlertDemo() {
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
    const timer = window.setInterval(load, 5000);
    document.addEventListener("visibilitychange", load);
    load();
    return () => {
      request?.abort();
      stream.close();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refresh]);
  return snapshot;
}

export function WearAlertForm({ snapshot, settings = false }: { snapshot: WearAlertSnapshot | null; settings?: boolean }) {
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
          {settings ? "Save thresholds" : "Submit mock prediction"}
        </button>
      </form>
      {snapshot && !snapshot.enabled && <p className="mt-2 text-xs text-[#a5bdd0]">Mock prediction controls are disabled on the server.</p>}
      <p role="status" className="mt-2 text-xs text-[#a5bdd0]">{message}</p>
    </>
  );
  return settings ? content : <Panel title="Mock tool wear prediction">{content}</Panel>;
}
