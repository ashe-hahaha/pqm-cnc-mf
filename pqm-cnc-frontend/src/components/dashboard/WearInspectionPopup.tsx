"use client";

import { useEffect, useRef } from "react";
import { toolKey, toolLabel } from "@/lib/toolNumber";
import { THRESHOLD_NOT_SET, type WearInspection } from "./WearAlertDemo";

const METRICS = [
  { key: "diameter", label: "Diameter wear" },
  { key: "length", label: "Tool length wear" },
] as const;

/**
 * Second popup: the controller reported new wear values after the laser inspection. Shows the measured wear against the
 * prediction and the threshold, then asks whether to do a second run.
 */
export function WearInspectionPopup({ inspection, onSecondRun, onDismiss }: {
  inspection: WearInspection | null | undefined;
  onSecondRun: (alertId: string) => void;
  onDismiss: (alertId: string) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const result = inspection?.status === "result_ready" ? inspection.result : null;
  const alertId = inspection?.alertId;

  useEffect(() => {
    if (!alertId || !result) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(alertId); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [alertId, result, onDismiss]);

  if (!inspection || !result) return null;
  const limited = METRICS.filter(({ key }) => result.thresholds[key] < THRESHOLD_NOT_SET);
  const exceeded = limited.some(({ key }) => result.exceeded.includes(key));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="wear-inspection-title" aria-describedby="wear-inspection-body"
        className="w-[min(92vw,26rem)] rounded-xl border border-[#3d8fd1]/50 bg-[#101a26] p-5 shadow-2xl shadow-black/60">
        <div className="min-w-0">
          <h2 id="wear-inspection-title" className="text-sm font-semibold text-foreground">Laser inspection result</h2>
          <p className="text-[11px] text-[#8fa3b5]">
            {toolLabel(toolKey(inspection.toolNo))} · {new Date(result.timestampUtc).toLocaleString()}
          </p>
        </div>
        <ul id="wear-inspection-body" className="mt-3 space-y-1.5 text-xs">
          {METRICS.map(({ key, label }) => {
            const threshold = result.thresholds[key];
            const set = threshold < THRESHOLD_NOT_SET;
            const over = result.exceeded.includes(key);
            return (
              <li key={key} className="rounded border border-[#2a3a4a] bg-[#0e1620] px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[#c6d7e4]">{label}</span>
                  <span className="tabular-nums text-[#e6f1fa]">{result.actual[key]} mm</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-[#8fa3b5]">
                  <span>Predicted {result.predicted[key]} mm · Threshold {set ? `${threshold} mm` : "not set"}</span>
                  {set && <span className={over ? "text-rose-300" : "text-emerald-300"}>{over ? "Still above threshold" : "Within threshold"}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {limited.length > 0 && (
          <p className={`mt-2 text-[11px] ${exceeded ? "text-rose-300" : "text-emerald-300"}`}>
            {exceeded ? "Wear is still above the threshold." : "Wear is back within the threshold."}
          </p>
        )}
        <p className="mt-3 text-xs text-[#c6d7e4]">Do you want to perform a second run?</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onDismiss(inspection.alertId)}
            className="rounded border border-[#314254] px-3 py-1.5 text-xs text-[#8fa3b5] hover:text-[#c1d6e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
            Not now
          </button>
          <button ref={confirmRef} type="button" onClick={() => onSecondRun(inspection.alertId)}
            className="rounded border border-[#3d8fd1]/60 bg-[#23425b] px-3 py-1.5 text-xs font-semibold text-[#a5d8fa] hover:bg-[#2b5272] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
            Yes, second run
          </button>
        </div>
      </div>
    </div>
  );
}
