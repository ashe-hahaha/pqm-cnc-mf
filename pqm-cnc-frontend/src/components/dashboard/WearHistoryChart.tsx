"use client";
import { useState } from "react";
import type { WearHistory } from "@/lib/useWearHistory";

type WearSeries = { axis: "x" | "z"; label: string; color: string };

export function WearHistoryChart({ history, series }: { history: WearHistory; series: readonly WearSeries[] }) {
  const [hidden, setHidden] = useState<WearSeries["axis"][]>([]);
  const numbers = series.flatMap(({ axis }) => history.data.flatMap(point => {
    const value = point[`${axis}WearMm`];
    return value === null ? [] : [value];
  }));
  if (!numbers.length) return <div className="flex h-full items-center justify-center text-xs text-[#8296a8]">No wear history in this range.</div>;
  const min = Math.min(...numbers), max = Math.max(...numbers);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.02, 0.001);
  const low = min - pad, high = max + pad;
  const timestamps = history.data
    .filter(point => series.some(({ axis }) => point[`${axis}WearMm`] !== null))
    .map(point => point.timestampEpoch);
  const t0 = Math.min(...timestamps);
  const t1 = Math.max(...timestamps);
  const x = (t: number) => t0 === t1 ? 342 : 62 + (t - t0) / (t1 - t0) * 560;
  const y = (v: number) => 175 - (v - low) / (high - low) * 150;
  return <div className="flex min-h-[150px] flex-1 flex-col">
    <div className="mb-1 flex flex-wrap gap-2" aria-label="Wear chart legend">
      {series.map(({ axis, label, color }) => {
        const visible = !hidden.includes(axis);
        return <button key={axis} type="button" aria-pressed={visible}
          onClick={() => setHidden(previous => previous.includes(axis) ? previous.filter(item => item !== axis) : [...previous, axis])}
          className={`inline-flex items-center gap-1.5 rounded border border-[#314254] px-2 py-1 text-[10px] text-[#c6d7e4] hover:bg-[#192a39] focus-visible:outline-2 focus-visible:outline-sky-400 ${visible ? "" : "opacity-60 line-through"}`}>
          <span aria-hidden="true" className="h-0.5 w-3" style={{ backgroundColor: color }} />
          {label}
        </button>;
      })}
    </div>
    <svg viewBox="0 0 640 220" className="min-h-0 w-full flex-1" role="img" aria-label="Tool wear history">
      <rect x="62" y="25" width="560" height="150" fill="#0a141e" rx="4" />
      {[0, 0.5, 1].map(f => <g key={f}><line x1="62" x2="622" y1={25 + f * 150} y2={25 + f * 150} stroke="#253b4c" /><text x="55" y={29 + f * 150} textAnchor="end" fontSize="10" fill="#8296a8">{(high - f * (high - low)).toFixed(3)}</text></g>)}
      <text x="62" y="15" fontSize="10" fill="#8296a8">mm</text>
      {series.filter(({ axis }) => !hidden.includes(axis)).map(({ axis, label, color }) => {
        const values = history.data.filter(point => point[`${axis}WearMm`] !== null);
        if (!values.length) return null;
        const path = history.data.map((p, i) => {
          const value = p[`${axis}WearMm`];
          if (value === null) return "";
          const segment = p[`${axis}Segment`];
          const previous = history.data[i - 1];
          const command = previous && previous[`${axis}WearMm`] !== null && previous[`${axis}Segment`] === segment ? "L" : "M";
          return `${command}${x(p.timestampEpoch).toFixed(2)},${y(value).toFixed(2)}`;
        }).join(" ");
        return <g key={axis} aria-label={label}>
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {values.map((point, i) => {
            const value = point[`${axis}WearMm`]!;
            return <circle key={`${point.timestampEpoch}-${i}`} cx={x(point.timestampEpoch)} cy={y(value)} r={values.length === 1 ? 4 : 2} fill={color}>
              <title>{`${label} · ${new Date(point.timestampEpoch).toLocaleString()} · ${value.toFixed(3)} mm · Tool ${point.toolNo ?? "unknown"}`}</title>
            </circle>;
          })}
        </g>;
      })}
      <text x="62" y="197" fontSize="10" fill="#8296a8">{new Date(t0).toLocaleTimeString()}</text>
      <text x="622" y="197" textAnchor="end" fontSize="10" fill="#8296a8">{new Date(t1).toLocaleTimeString()}</text>
      <text x="342" y="214" textAnchor="middle" fontSize="9" fill="#70889c">{new Date(t0).toLocaleDateString()} — {new Date(t1).toLocaleDateString()}</text>
    </svg>
  </div>;
}
