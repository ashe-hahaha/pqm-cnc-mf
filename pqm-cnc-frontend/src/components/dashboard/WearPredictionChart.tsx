"use client";

import { useId, useState } from "react";
import type { WearPrediction } from "./WearAlertDemo";

const SERIES = [
  { key: "diameter", label: "Diameter wear", short: "D", color: "#38bdf8" },
  { key: "length", label: "Tool length wear", short: "L", color: "#c4a0ff" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

/** Backend default for a threshold nobody has set. */
const THRESHOLD_NOT_SET = 999;

/** An actually measured wear value (controller record), drawn as a marker only. */
export type MeasuredWear = { t: number; diameter: number | null; length: number | null };

const WIDTH = 640;
const HEIGHT = 210;
const LEFT = 40;
const TOP = 14;
const PLOT_W = WIDTH - LEFT - 12;
const PLOT_H = HEIGHT - TOP - 30;

/**
 * Predicted diameter / length wear (lines + points, red above threshold) with optional measured markers.
 * `xMode="index"` spaces predictions evenly by sequence; `"time"` places everything by timestamp.
 */
export function WearPredictionChart({
  points,
  thresholds,
  measured = [],
  xMode = "index",
  emptyMessage = "No prediction yet.",
}: {
  points: readonly WearPrediction[];
  thresholds?: { diameter: number; length: number };
  measured?: readonly MeasuredWear[];
  xMode?: "index" | "time";
  emptyMessage?: string;
}) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ diameter: true, length: true });
  const [hover, setHover] = useState<number | null>(null);
  const fillId = useId();
  const latest = points.at(-1);
  const exceeds = (key: SeriesKey, value: number) => thresholds !== undefined && value > thresholds[key];
  const shown = SERIES.filter(item => visible[item.key]);
  const measuredShown = measured.filter(m => shown.some(item => m[item.key] !== null));

  const values = [
    ...shown.flatMap(item => points.map(point => point[item.key])),
    ...shown.flatMap(item => measuredShown.flatMap(m => (m[item.key] === null ? [] : [m[item.key] as number]))),
  ];
  const dataMax = Math.max(0.05, ...values);
  // The default threshold (999) means "not set" and is not drawn, otherwise it would flatten the curves.
  const limits = shown.flatMap(item => {
    const limit = thresholds?.[item.key];
    return limit !== undefined && limit < THRESHOLD_NOT_SET ? [{ ...item, limit }] : [];
  });
  const unsetNames = shown.filter(item => !limits.some(limit => limit.key === item.key)).map(item => item.short);
  const max = Math.max(dataMax, ...limits.map(item => item.limit)) * 1.18;
  const y = (value: number) => TOP + PLOT_H * (1 - value / max);

  const times = [...points.map(p => Date.parse(p.timestampUtc)), ...measuredShown.map(m => m.t)];
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const timeX = (t: number) => LEFT + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * PLOT_W;
  const indexX = (i: number) => LEFT + (points.length > 1 ? i / (points.length - 1) : 0.5) * PLOT_W;
  const px = (i: number) => (xMode === "time" ? timeX(Date.parse(points[i]!.timestampUtc)) : indexX(i));
  const lineOf = (key: SeriesKey) => points.map((point, i) => `${i ? "L" : "M"}${px(i)},${y(point[key])}`).join(" ");
  const ticks = [0, max / 3, (2 * max) / 3, max];
  const hovered = hover !== null ? points[hover] : undefined;
  const label = (point: WearPrediction, i: number) => `#${point.index ?? i + 1}`;
  const empty = points.length === 0 && measuredShown.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Toggle wear series">
          {SERIES.map(item => (
            <button key={item.key} type="button" aria-pressed={visible[item.key]}
              onClick={() => { setVisible(prev => ({ ...prev, [item.key]: !prev[item.key] })); setHover(null); }}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                visible[item.key] ? "border-[#314254] bg-[#0c1722] text-[#c6d7e4]" : "border-[#243141] text-[#5a6b7a] line-through hover:text-[#8296a8]"}`}>
              <span className="h-0.5 w-3 rounded" style={{ background: visible[item.key] ? item.color : "#5a6b7a" }} />
              {item.label}
            </button>
          ))}
          {measured.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#8296a8]">
              <svg aria-hidden="true" width="10" height="10" viewBox="-5 -5 10 10"><path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill="none" stroke="#c6d7e4" strokeWidth="1.5" /></svg>
              Measured
            </span>
          )}
        </div>
        {latest && <span className="text-[10px] tabular-nums text-[#8fa3b5]">
          {SERIES.map(item => (
            <strong key={item.key} className={`ml-2 ${exceeds(item.key, latest[item.key]) ? "text-rose-300" : "text-emerald-300"}`}>
              {item.short} {latest[item.key].toFixed(3)} mm
            </strong>
          ))}
        </span>}
      </div>
      {empty ? (
        <p className="mt-2 text-xs text-[#8fa3b5]">{emptyMessage}</p>
      ) : (
        <div className="relative min-h-0 flex-1">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="absolute inset-0 h-full w-full" role="img"
            aria-label={`Predicted wear history, ${points.length} predictions, ${measuredShown.length} measured`} onMouseLeave={() => setHover(null)}>
            <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0" /></linearGradient></defs>
            <rect x={LEFT} y={TOP} width={PLOT_W} height={PLOT_H} rx="3" fill="#0a1219" stroke="#243141" />
            {ticks.map(value => <g key={value}>
              <line x1={LEFT} x2={LEFT + PLOT_W} y1={y(value)} y2={y(value)} stroke="#243141" />
              <text x={LEFT - 7} y={y(value) + 4} textAnchor="end" fontSize="10" fill="#8fa3b5">{value.toFixed(2)}</text>
            </g>)}
            {visible.diameter && points.length > 1 && (
              <path d={`${lineOf("diameter")} L${px(points.length - 1)},${TOP + PLOT_H} L${px(0)},${TOP + PLOT_H} Z`} fill={`url(#${fillId})`} />
            )}
            {limits.map(item => <g key={`limit-${item.key}`}>
              <line x1={LEFT} x2={LEFT + PLOT_W} y1={y(item.limit)} y2={y(item.limit)} stroke={item.color} strokeDasharray="5 4" opacity="0.8" />
              <text x={LEFT + PLOT_W - 4} y={y(item.limit) - 5} textAnchor="end" fontSize="10" fill={item.color}>{item.short} limit {item.limit.toFixed(3)} mm</text>
            </g>)}
            {shown.map(item => <g key={item.key} aria-label={item.label}>
              {points.length > 1 && <path d={lineOf(item.key)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />}
              {points.map((point, i) => (
                <circle key={i} cx={px(i)} cy={y(point[item.key])} r={hover === i ? 5 : 3}
                  fill={exceeds(item.key, point[item.key]) ? "#fb7185" : item.color} stroke={item.color} strokeWidth="1" />
              ))}
              {measuredShown.map((m, i) => {
                const value = m[item.key];
                if (value === null) return null;
                const cx = timeX(m.t);
                const cy = y(value);
                return (
                  <path key={`m-${i}`} d={`M${cx},${cy - 5} L${cx + 5},${cy} L${cx},${cy + 5} L${cx - 5},${cy} Z`}
                    fill="#0a1219" stroke={item.color} strokeWidth="1.8">
                    <title>{`Measured ${item.label} · ${new Date(m.t).toLocaleString()} · ${value.toFixed(3)} mm`}</title>
                  </path>
                );
              })}
            </g>)}
            {points.map((point, i) => (
              <circle key={`hit-${i}`} cx={px(i)} cy={TOP + PLOT_H / 2} r={Math.max(8, Math.min(24, PLOT_W / Math.max(points.length, 1) / 2))}
                fill="transparent" onMouseEnter={() => setHover(i)}>
                <title>{label(point, i)}</title>
              </circle>
            ))}
            {xMode === "index" && points.length > 0 && <>
              <text x={px(0)} y={TOP + PLOT_H + 14} textAnchor={points.length > 1 ? "start" : "middle"} fontSize="8" fill="#6b7c8f">{label(points[0]!, 0)}</text>
              {points.length > 1 && <text x={px(points.length - 1)} y={TOP + PLOT_H + 14} textAnchor="end" fontSize="8" fill="#6b7c8f">{label(latest!, points.length - 1)}</text>}
            </>}
            {xMode === "time" && Number.isFinite(t0) && <>
              <text x={LEFT} y={TOP + PLOT_H + 14} textAnchor={t1 === t0 ? "middle" : "start"} fontSize="8" fill="#6b7c8f" dx={t1 === t0 ? PLOT_W / 2 : 0}>{new Date(t0).toLocaleString()}</text>
              {t1 !== t0 && <text x={LEFT + PLOT_W} y={TOP + PLOT_H + 14} textAnchor="end" fontSize="8" fill="#6b7c8f">{new Date(t1).toLocaleString()}</text>}
            </>}
          </svg>
          {hovered && (
            <div className="pointer-events-none absolute left-2 top-1 z-10 rounded-md border border-[#2a3a4a] bg-[#0b111b]/95 px-2 py-1.5 text-[10px] shadow-lg">
              <p className="text-[#c5d4e3]">{label(hovered, hover ?? 0)} · {new Date(hovered.timestampUtc).toLocaleString()}</p>
              {shown.map(item => (
                <p key={item.key} style={{ color: exceeds(item.key, hovered[item.key]) ? "#fda4af" : item.color }}>
                  {item.label} {hovered[item.key].toFixed(3)} mm
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {unsetNames.length > 0 && !empty && (
        <p className="shrink-0 text-[9px] text-[#6b7c8f]">
          {unsetNames.join(" and ")} threshold not set — set it with ⚙ on the Tool Wear page.
        </p>
      )}
    </div>
  );
}
