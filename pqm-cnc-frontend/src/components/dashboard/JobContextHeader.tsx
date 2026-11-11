import type { ReactNode } from "react";
import type { DrawingBalloon, JobContext } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { LiveClock } from "@/components/LiveClock";
import {
  DrawingSourcePicker,
  type ActiveDrawing,
} from "./DrawingSourcePicker";

export function JobContextHeader({
  job,
  selected,
  drawing,
  onDrawingSelect,
  simLabel,
  simSpeed = 1,
  onSimSpeedChange,
  layoutLocked = false,
  onLayoutLockedChange,
  canLoadNext = false,
  onLoadNextPiece,
  actions,
}: {
  job: JobContext;
  selected: DrawingBalloon | null;
  drawing: ActiveDrawing | null;
  onDrawingSelect: (drawing: ActiveDrawing) => void;
  simLabel?: string;
  simSpeed?: number;
  onSimSpeedChange?: (speed: number) => void;
  layoutLocked?: boolean;
  onLayoutLockedChange?: (locked: boolean) => void;
  canLoadNext?: boolean;
  onLoadNextPiece?: () => void;
  /** Extra header controls rendered before the notifications icon. */
  actions?: ReactNode;
}) {
  const product =
    drawing?.jobId && drawing.jobId !== "_uploads"
      ? drawing.jobName
      : job.productCode;
  const program = drawing?.programName ?? job.programName;
  const batchPct = Math.round((job.batchCompleted / job.batchTotal) * 100);
  const inspectPct = Math.round((job.inspectedParts / job.batchTotal) * 100);

  return (
    <header className="border-b border-[#243141] bg-[#0b111b]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div>
          <h1 className="text-[13px] font-semibold tracking-wide text-foreground">
            PREDICTIVE QUALITY MONITORING
            <span className="ml-2 font-normal text-[#3d8fd1]">
              | Operational Dashboard
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DrawingSourcePicker active={drawing} onSelect={onDrawingSelect} />
          {simLabel ? (
            <span
              className="max-w-[280px] truncate rounded-lg border border-[#3d8fd1]/40 bg-[#3d8fd1]/10 px-2.5 py-1 text-[11px] text-[#7eb6e8]"
              title={simLabel}
            >
              {simLabel}
            </span>
          ) : null}
          {onLoadNextPiece ? (
            <button
              type="button"
              disabled={!canLoadNext}
              onClick={onLoadNextPiece}
              title="Load next piece (shortcut: N)"
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em]",
                canLoadNext
                  ? "border-[#fbbf24]/50 bg-[#fbbf24]/15 text-[#fbbf24] hover:bg-[#fbbf24]/25"
                  : "border-[#243141] text-[#3a4a5a]",
              )}
            >
              Next <span className="opacity-70">N</span>
            </button>
          ) : null}
          {onSimSpeedChange ? (
            <div className="flex overflow-hidden rounded-lg border border-[#243141] text-[10px] uppercase tracking-[0.08em]">
              {[1, 10].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSimSpeedChange(s)}
                  className={
                    simSpeed === s
                      ? "bg-[#3d8fd1]/20 px-2 py-1 text-[#7eb6e8]"
                      : "px-2 py-1 text-[#6b7c8f] hover:text-foreground"
                  }
                >
                  {s}×
                </button>
              ))}
            </div>
          ) : null}
          {onLayoutLockedChange ? (
            <button
              type="button"
              onClick={() => onLayoutLockedChange(!layoutLocked)}
              title={
                layoutLocked
                  ? "Unlock layout editing"
                  : "Lock layout (sizes are saved)"
              }
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em]",
                layoutLocked
                  ? "border-[#3d8fd1]/50 bg-[#3d8fd1]/15 text-[#7eb6e8]"
                  : "border-[#243141] text-[#8fa3b5] hover:border-[#3d8fd1]/40 hover:text-[#7eb6e8]",
              )}
            >
              {layoutLocked ? "Layout locked" : "Lock layout"}
            </button>
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-good/40 bg-good/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-good">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
            LIVE
          </span>
          <LiveClock className="text-xs text-[#9eb0c0]" />
          {actions}
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#243141] bg-[#121a24] text-sm text-[#8fa3b5]"
            title="Notifications"
            aria-hidden
          >
            🔔
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-[#243141] bg-[#0e1620]/80 px-4 py-3">
        <Field label="Machine" value={job.machineCode} />
        <Field label="Product ID" value={product} />
        <Field label="Work Order" value={job.workOrder} />
        <Field label="Program" value={program} />
        <Field label="Current Operation" value={job.currentOperation} />
        <Field label="Current Tool" value={job.currentTool} />
        <Field label="Balloon" value={selected?.code ?? "—"} />
        <Field label="Material" value={job.material} />
        <ProgressField
          label="Batch Progress"
          value={`${job.batchCompleted} / ${job.batchTotal} parts`}
          pct={batchPct}
        />
        <ProgressField
          label="Inspected Parts"
          value={`${job.inspectedParts} / ${job.batchTotal}`}
          pct={inspectPct}
        />
      </div>
    </header>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <p className="text-[10px] uppercase tracking-[0.1em] text-[#6b7c8f]">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ProgressField({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="min-w-[9rem]">
      <p className="text-[10px] uppercase tracking-[0.1em] text-[#6b7c8f]">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#1a2836]">
        <div
          className="h-full rounded-full bg-[#3d8fd1]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
