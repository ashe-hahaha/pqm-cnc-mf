"use client";

import { useId, useState } from "react";
import { TrendPanel } from "./TrendPanel";
import type { WearAlertSnapshot } from "./WearAlertDemo";

const TOOL_LABEL = "T25";
/** Backend default for a threshold nobody has set. */
const THRESHOLD_NOT_SET = 999;
const SERIES = [
  { key: "diameter", label: "Diameter wear", short: "D", color: "#38bdf8" },
  { key: "length", label: "Tool length wear", short: "L", color: "#c4a0ff" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

/** Diameter and length wear predictions for the fixed demo tool (sliding window), with backend thresholds. */
export function ToolWearTrend({ snapshot = null }: { snapshot?: WearAlertSnapshot | null }) {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ diameter: true, length: true });
  const [hover, setHover] = useState<number | null>(null);
  const fillId = useId();
  const history = snapshot?.history ?? [];
  const thresholds = snapshot?.thresholds;
  const latest = history.at(-1);
  const exceeds = (key: SeriesKey, value: number) => thresholds !== undefined && value > thresholds[key];
  const latestExceeded = latest ? SERIES.some(item => exceeds(item.key, latest[item.key])) : false;

  const width = 640;
  const height = 210;
  const left = 40;
  const top = 14;
  const plotWidth = width - left - 12;
  const plotHeight = height - top - 30;
  const shown = SERIES.filter(item => visible[item.key]);
  const dataMax = Math.max(0.05, ...shown.flatMap(item => history.map(point => point[item.key])));
  // Thresholds come from the Tool Wear page settings; the default (999) means "not set" and is not drawn,
  // otherwise it would flatten the curves.
  const limits = shown.flatMap(item => {
    const limit = thresholds?.[item.key];
    return limit !== undefined && limit < THRESHOLD_NOT_SET ? [{ ...item, limit }] : [];
  });
  const unsetNames = shown.filter(item => !limits.some(limit => limit.key === item.key)).map(item => item.short);
  const max = Math.max(dataMax, ...limits.map(item => item.limit)) * 1.18;
  const x = (i: number) => left + (history.length > 1 ? i / (history.length - 1) : 0.5) * plotWidth;
  const y = (value: number) => top + plotHeight * (1 - value / max);
  const lineOf = (key: SeriesKey) => history.map((point, i) => `${i ? "L" : "M"}${x(i)},${y(point[key])}`).join(" ");
  const ticks = [0, max / 3, (2 * max) / 3, max];
  const hovered = hover !== null ? history[hover] : undefined;

  return (
    <TrendPanel id="tool-wear-trend" title={`Tool wear trend · ${TOOL_LABEL}`}
      description={<>{history.length} predicted · mock data · last 10 shown · mm</>}
      status={latest ? (
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${latestExceeded ? "bg-bad" : "bg-good"} text-[#0b1724]`}>
          {latestExceeded ? "High wear" : "Within limit"}
        </span>
      ) : null}
      controls={
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
          </div>
          {latest && <span className="text-[10px] tabular-nums text-[#8fa3b5]">
            {SERIES.map(item => (
              <strong key={item.key} className={`ml-2 ${exceeds(item.key, latest[item.key]) ? "text-rose-300" : "text-emerald-300"}`}>
                {item.short} {latest[item.key].toFixed(3)} mm
              </strong>
            ))}
          </span>}
        </div>
      }>
      {history.length === 0 ? (
        <p className="mt-2 text-xs text-[#8fa3b5]">No prediction yet — trigger one from the flask icon in the top bar.</p>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" role="img"
              aria-label={`${TOOL_LABEL} tool wear trend, ${history.length} predictions`} onMouseLeave={() => setHover(null)}>
              <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.18" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0" /></linearGradient></defs>
              <rect x={left} y={top} width={plotWidth} height={plotHeight} rx="3" fill="#0a1219" stroke="#243141" />
              {ticks.map(value => <g key={value}>
                <line x1={left} x2={left + plotWidth} y1={y(value)} y2={y(value)} stroke="#243141" />
                <text x={left - 7} y={y(value) + 4} textAnchor="end" fontSize="10" fill="#8fa3b5">{value.toFixed(2)}</text>
              </g>)}
              {visible.diameter && history.length > 1 && (
                <path d={`${lineOf("diameter")} L${x(history.length - 1)},${top + plotHeight} L${x(0)},${top + plotHeight} Z`} fill={`url(#${fillId})`} />
              )}
              {limits.map(item => <g key={`limit-${item.key}`}>
                <line x1={left} x2={left + plotWidth} y1={y(item.limit)} y2={y(item.limit)} stroke={item.color} strokeDasharray="5 4" opacity="0.8" />
                <text x={left + plotWidth - 4} y={y(item.limit) - 5} textAnchor="end" fontSize="10" fill={item.color}>{item.short} limit {item.limit.toFixed(3)} mm</text>
              </g>)}
              {shown.map(item => <g key={item.key}>
                {history.length > 1 && <path d={lineOf(item.key)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />}
                {history.map((point, i) => (
                  <circle key={i} cx={x(i)} cy={y(point[item.key])} r={hover === i ? 5 : 3}
                    fill={exceeds(item.key, point[item.key]) ? "#fb7185" : item.color} stroke={item.color} strokeWidth="1" />
                ))}
              </g>)}
              {history.map((point, i) => (
                <rect key={`hit-${i}`} x={x(i) - plotWidth / Math.max(history.length, 1) / 2} y={top}
                  width={plotWidth / Math.max(history.length, 1)} height={plotHeight} fill="transparent" onMouseEnter={() => setHover(i)}>
                  <title>{`#${point.index ?? i + 1}`}</title>
                </rect>
              ))}
              <text x={x(0)} y={top + plotHeight + 14} textAnchor={history.length > 1 ? "start" : "middle"} fontSize="8" fill="#6b7c8f">#{history[0]!.index ?? 1}</text>
              {history.length > 1 && <text x={x(history.length - 1)} y={top + plotHeight + 14} textAnchor="end" fontSize="8" fill="#6b7c8f">#{latest!.index ?? history.length}</text>}
            </svg>
          </div>
          {unsetNames.length > 0 && (
            <p className="shrink-0 text-[9px] text-[#6b7c8f]">
              {unsetNames.join(" and ")} threshold not set — set it with ⚙ on the Tool Wear page.
            </p>
          )}
          {hovered && (
            <div className="pointer-events-none absolute left-2 top-1 z-10 rounded-md border border-[#2a3a4a] bg-[#0b111b]/95 px-2 py-1.5 text-[10px] shadow-lg">
              <p className="text-[#c5d4e3]">#{hovered.index ?? (hover ?? 0) + 1} · {new Date(hovered.timestampUtc).toLocaleTimeString()}</p>
              {shown.map(item => (
                <p key={item.key} style={{ color: exceeds(item.key, hovered[item.key]) ? "#fda4af" : item.color }}>
                  {item.label} {hovered[item.key].toFixed(3)} mm
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </TrendPanel>
  );
}
