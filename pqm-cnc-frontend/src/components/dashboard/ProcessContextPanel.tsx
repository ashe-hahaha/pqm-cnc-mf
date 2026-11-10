"use client";
import { useControllerData } from "@/lib/useControllerData";
import type {
  BalloonProcessContext,
  ProcessTrendKey,
} from "@/domain/opsDashboard";
import { LiveSignalScopes } from "@/components/charts/LiveSignalScopes";
import { TrendSparkMini } from "@/components/charts/TrendSparkMini";
import { Panel } from "./Panel";

/** Setpoint-style parameters keep step/plateau sparklines; vibration + acoustic are HF scopes. */
const METRICS: {
  key: ProcessTrendKey;
  label: string;
  format: (ctx: BalloonProcessContext) => string;
}[] = [
  {
    key: "feed",
    label: "Feedrate",
    format: (c) => `${c.feedMmMin.toLocaleString()} mm/min`,
  },
  {
    key: "spindle",
    label: "Spindle speed",
    format: (c) => `${c.spindleRpm.toLocaleString()} rpm`,
  },
  { key: "doc", label: "AP · Depth of cut", format: (c) => `${c.estimatedDocMm} mm` },
  { key: "woc", label: "AE · Width of cut", format: (c) => `${c.estimatedWocMm} mm` },

];

export function ProcessContextPanel({
  balloonCode,
  streaming = false,
}: {
  balloonCode: string | null;
  context: BalloonProcessContext | null;
  /** True while a balloon cycle is in progress — trends grow left → right. */
  streaming?: boolean;
}) {
  const { rows, status } = useControllerData();
  const latest = rows.at(-1);
  return (
    <Panel
      id="process"
      title={`Process context${balloonCode ? ` · Balloon ${balloonCode}` : ""}`}
      className="h-full"
      titleRight={
        <span className="text-[10px] font-normal normal-case tracking-normal text-[#8fa3b5]">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5 text-[#a78bfa]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a78bfa]" />
              Streaming
            </span>
          ) : (
            "Live trends"
          )}
        </span>
      }
    >
      <p className="mb-2 text-[10px] text-[#8fa3b5]">Controller · {status} · machine-wide</p>

        <ul className="space-y-0">
          {METRICS.map((m) => {
            const field = m.key === "feed" ? "feed_rate" : m.key === "spindle" ? "spindle_speed" : m.key === "doc" ? "AP" : "AE";
            const value = latest?.[field];
            const unit = m.key === "feed" ? "mm/min" : m.key === "spindle" ? "rpm" : "mm";
            return (
            <li
              key={m.key}
              className="flex items-center gap-3 border-b border-[#2a3a4a]/70 py-2 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.1em] text-[#8fa3b5]">
                  {m.label}
                </p>
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {typeof value === "number" && Number.isFinite(value) ? `${value} ${unit}` : "—"}
                </p>
              </div>
              <TrendSparkMini
                series={rows.map(row => row[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v))}
                label={m.label}
                animate={!streaming}
              />
            </li>
          ); })}
        </ul>
      <LiveSignalScopes />
    </Panel>
  );
}
