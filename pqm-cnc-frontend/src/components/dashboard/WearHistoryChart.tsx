"use client";
import type { WearHistory } from "@/lib/useWearHistory";

export function WearHistoryChart({ history, axis, label, color }: { history: WearHistory; axis: "x" | "z"; label: string; color: string }) {
  const values = history.data.filter(point => point[`${axis}WearMm`] !== null);
  if (!values.length) return <div className="flex h-full items-center justify-center text-xs text-[#8296a8]">No {label.toLowerCase()} history in this range.</div>;
  const numbers = values.map(p => p[`${axis}WearMm`] as number);
  const min = Math.min(...numbers), max = Math.max(...numbers);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.02, 0.001);
  const low = min - pad, high = max + pad;
  const t0 = history.start ? Date.parse(history.start) : values[0].timestampEpoch;
  const t1 = history.end ? Date.parse(history.end) : values[values.length - 1].timestampEpoch;
  const x = (t: number) => 62 + (t - t0) / Math.max(t1 - t0, 1) * 560;
  const y = (v: number) => 175 - (v - low) / (high - low) * 150;
  const path = history.data.map((p, i) => {
    const value = p[`${axis}WearMm`];
    if (value === null) return "";
    const segment = p[`${axis}Segment`];
    const previous = history.data[i - 1];
    const command = previous && previous[`${axis}WearMm`] !== null && previous[`${axis}Segment`] === segment ? "L" : "M";
    return `${command}${x(p.timestampEpoch).toFixed(2)},${y(value).toFixed(2)}`;
  }).join(" ");
  return <svg viewBox="0 0 640 220" className="h-full w-full" role="img" aria-label={`${label} history`}>
    <rect x="62" y="25" width="560" height="150" fill="#0a141e" rx="4" />
    {[0, 0.5, 1].map(f => <g key={f}><line x1="62" x2="622" y1={25 + f * 150} y2={25 + f * 150} stroke="#253b4c" /><text x="55" y={29 + f * 150} textAnchor="end" fontSize="10" fill="#8296a8">{(high - f * (high - low)).toFixed(3)}</text></g>)}
    <text x="62" y="15" fontSize="10" fill="#8296a8">mm</text>
    <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    {values.map((p, i) => <circle key={`${p.timestampEpoch}-${i}`} cx={x(p.timestampEpoch)} cy={y(p[`${axis}WearMm`] as number)} r={values.length === 1 ? 4 : 2} fill={color}><title>{`${new Date(p.timestampEpoch).toLocaleString()} · ${(p[`${axis}WearMm`] as number).toFixed(3)} mm · Tool ${p.toolNo ?? "unknown"}`}</title></circle>)}
    <text x="62" y="197" fontSize="10" fill="#8296a8">{new Date(t0).toLocaleTimeString()}</text>
    <text x="622" y="197" textAnchor="end" fontSize="10" fill="#8296a8">{new Date(t1).toLocaleTimeString()}</text>
    <text x="342" y="214" textAnchor="middle" fontSize="9" fill="#70889c">{new Date(t0).toLocaleDateString()} — {new Date(t1).toLocaleDateString()}</text>
  </svg>;
}
