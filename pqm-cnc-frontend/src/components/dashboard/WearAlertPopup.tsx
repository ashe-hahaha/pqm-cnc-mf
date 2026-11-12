"use client";

import { useEffect, useRef, useState } from "react";
import { toolKey, toolLabel } from "@/lib/toolNumber";
import type { ToolWearAlert } from "./WearAlertDemo";

const METRIC_LABEL = { diameter: "Diameter wear", length: "Tool length wear" } as const;

/** Centered warning shown on the home page when a new tool wear alert fires; Confirm goes to the Tool Wear page. */
export function WearAlertPopup({ alerts, destinations = [], onConfirm, onDismiss }: {
  alerts: readonly ToolWearAlert[];
  /** Notification targets the backend sends the alert to (shown in the details). */
  destinations?: readonly string[];
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const alert = alerts.at(-1);

  useEffect(() => {
    if (!alert) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [alert, onDismiss]);
  useEffect(() => setShowDetails(false), [alert?.alertId]);

  if (!alert) return null;
  const { prediction, thresholds } = alert;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="wear-alert-title" aria-describedby="wear-alert-body"
        className="w-[min(92vw,26rem)] rounded-xl border border-bad/60 bg-[#101a26] p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bad/20 text-lg font-bold text-bad">!</span>
          <div className="min-w-0">
            <h2 id="wear-alert-title" className="text-sm font-semibold text-foreground">Tool wear warning</h2>
            <p className="text-[11px] text-[#8fa3b5]">
              {toolLabel(toolKey(prediction.toolNo))} · {new Date(alert.timestampUtc).toLocaleString()}
              {alerts.length > 1 ? ` · ${alerts.length} new alerts` : ""}
            </p>
          </div>
        </div>
        <ul id="wear-alert-body" className="mt-3 space-y-1.5 text-xs">
          {alert.metrics.map(metric => (
            <li key={metric} className="flex items-baseline justify-between gap-3 rounded border border-[#2a3a4a] bg-[#0e1620] px-2.5 py-1.5">
              <span className="text-[#c6d7e4]">{METRIC_LABEL[metric]}</span>
              <span className="tabular-nums text-rose-300">{prediction[metric]} mm <span className="text-[#8fa3b5]">&gt; {thresholds[metric]} mm</span></span>
            </li>
          ))}
        </ul>
        {showDetails && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-[#8fa3b5]">Prediction</dt>
            <dd className="text-[#c6d7e4]">{prediction.index ? `#${prediction.index}` : "—"} · Diameter {prediction.diameter} mm · Length {prediction.length} mm</dd>
            <dt className="text-[#8fa3b5]">Machine</dt>
            <dd className="text-[#c6d7e4]">{prediction.machineId}</dd>
            <dt className="text-[#8fa3b5]">Notified</dt>
            <dd className="text-[#c6d7e4]">{destinations.length ? destinations.map(name => name === "kafka" ? "Kafka" : name === "temi" ? "Temi" : name).join(", ") : "No notification target enabled"}</dd>
            <dt className="text-[#8fa3b5]">Alert ID</dt>
            <dd className="break-all text-[#c6d7e4]">{alert.alertId}</dd>
          </dl>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails(v => !v)}
            className="rounded px-2 py-1 text-[11px] text-[#8fa3b5] hover:bg-[#192a39] hover:text-[#c1d6e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
            {showDetails ? "Hide details" : "Details"}
          </button>
          <span className="flex gap-2">
            <button type="button" onClick={onDismiss}
              className="rounded border border-[#314254] px-3 py-1.5 text-xs text-[#8fa3b5] hover:text-[#c1d6e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
              Dismiss
            </button>
            <button ref={confirmRef} type="button" onClick={onConfirm}
              className="rounded border border-[#3d8fd1]/60 bg-[#23425b] px-3 py-1.5 text-xs font-semibold text-[#a5d8fa] hover:bg-[#2b5272] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
              Confirm · go to Tool Wear
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
