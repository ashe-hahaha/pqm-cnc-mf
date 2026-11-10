"use client";

import { useId, useState } from "react";
import { TrendPanel } from "./TrendPanel";

// Only T06 has demo data. Add tool records here when further data is available.
const TOOL_SERIES = [{
  id: "T06",
  name: "Precision boring tool",
  threshold: 0.3,
  points: [0.071, 0.078, 0.086, 0.092, 0.104, 0.116, 0.123, 0.139, 0.151, 0.163,
    0.177, 0.192, 0.208, 0.221, 0.243, 0.259, 0.278, 0.299, 0.319, 0.34],
}];

export function ToolWearTrend() {
  const [toolId, setToolId] = useState(TOOL_SERIES[0].id);
  const [dimension, setDimension] = useState<"diameter" | "length">("diameter");
  const [hover, setHover] = useState<number | null>(null);
  const fillId = useId();
  const source = TOOL_SERIES.find((item) => item.id === toolId)!;
  const metricLabel = dimension === "diameter" ? "Diameter wear" : "Tool length wear";
  const tool = dimension === "diameter" ? source : {
    ...source,
    threshold: 0.2,
    points: [0.025, 0.03, 0.033, 0.039, 0.042, 0.049, 0.055, 0.061, 0.069, 0.076,
      0.084, 0.093, 0.102, 0.113, 0.122, 0.134, 0.147, 0.16, 0.175, 0.19],
  };
  const latest = tool.points[tool.points.length - 1];
  const exceeded = latest > tool.threshold;
  const width = 640;
  const height = 210;
  const left = 40;
  const top = 14;
  const plotWidth = width - left - 12;
  const plotHeight = height - top - 30;
  const max = Math.max(tool.threshold, ...tool.points) * 1.18;
  const x = (i: number) => left + i / Math.max(tool.points.length - 1, 1) * plotWidth;
  const y = (value: number) => top + plotHeight * (1 - value / max);
  const line = tool.points.map((value, i) => `${i ? "L" : "M"}${x(i)},${y(value)}`).join(" ");

  return (
    <TrendPanel id="tool-wear-trend" title="Tool wear trend" description={<>{tool.points.length} predicted · mock data · {metricLabel} (mm)</>} status={
      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${exceeded ? "bg-bad" : "bg-good"} text-[#0b1724]`}>
        {exceeded ? "High wear" : "Within limit"}
      </span>
    } controls={
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[10px] text-[#8fa3b5]">
          Tool
          <select aria-label="Tool wear trend tool" value={toolId} onChange={(event) => { setToolId(event.target.value); setHover(null); }} className="rounded border border-[#314254] bg-[#0c1722] px-2 py-1 text-[11px] text-[#c6d7e4]">
            {TOOL_SERIES.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        </label>
        <select aria-label="Wear dimension" value={dimension} onChange={(event) => { setDimension(event.target.value as "diameter" | "length"); setHover(null); }} className="rounded border border-[#314254] bg-[#0c1722] px-2 py-1 text-[11px] text-[#c6d7e4]">
          <option value="diameter">Diameter wear</option><option value="length">Tool length wear</option>
        </select>
        <span className="text-[10px] tabular-nums text-[#8fa3b5]"><strong className={exceeded ? "text-rose-300" : "text-emerald-300"}>{latest.toFixed(3)} mm</strong></span>
      </div>
    }>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${tool.id} tool wear trend, ${latest.toFixed(3)} mm, threshold ${tool.threshold.toFixed(3)} mm`} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0" /></linearGradient></defs>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx="3" fill="#0a1219" stroke="#243141" />
          <rect x={left} y={y(tool.threshold)} width={plotWidth} height={top + plotHeight - y(tool.threshold)} fill="#34d399" opacity="0.06" />
          {[0, tool.threshold / 2, tool.threshold].map((value) => <g key={value}>
            <line x1={left} x2={left + plotWidth} y1={y(value)} y2={y(value)} stroke="#243141" />
            <text x={left - 7} y={y(value) + 4} textAnchor="end" fontSize="10" fill="#8fa3b5">{value.toFixed(2)}</text>
          </g>)}
          <path d={`${line} L${x(tool.points.length - 1)},${top + plotHeight} L${left},${top + plotHeight} Z`} fill={`url(#${fillId})`} />
          <line x1={left} x2={left + plotWidth} y1={y(tool.threshold)} y2={y(tool.threshold)} stroke="#fb7185" strokeDasharray="5 4" />
          <text x={left + plotWidth - 4} y={y(tool.threshold) - 6} textAnchor="end" fontSize="10" fill="#fb7185">Limit {tool.threshold.toFixed(3)} mm</text>
          <path d={line} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
          {tool.points.map((value, i) => <g key={i} onMouseEnter={() => setHover(i)}>
            <circle cx={x(i)} cy={y(value)} r={hover === i ? 5 : 2.8} fill={value > tool.threshold ? "#fb7185" : "#38bdf8"} />
            <rect x={x(i) - 13} y={top} width="26" height={plotHeight} fill="transparent"><title>{`${toolId} · Window ${i + 1}: ${value.toFixed(3)} mm`}</title></rect>
          </g>)}
          <text x={left} y={top + plotHeight + 14} fontSize="8" fill="#6b7c8f">Window 01</text>
          <text x={left + plotWidth} y={top + plotHeight + 14} textAnchor="end" fontSize="8" fill="#6b7c8f">Window {tool.points.length}</text>
        </svg>
      </div>
      {hover !== null && <div className="pointer-events-none absolute left-2 top-1 z-10 rounded-md border border-[#2a3a4a] bg-[#0b111b]/95 px-2 py-1.5 text-[10px] shadow-lg"><p className="text-[#c5d4e3]">Window {hover + 1}</p><p className="mt-1 text-sky-300">{metricLabel} {tool.points[hover].toFixed(3)} mm</p></div>}
      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.08em] text-[#6b7c8f]"><span className="inline-flex items-center gap-1"><span className="h-0.5 w-2.5 bg-[#38bdf8]" />Pred</span><span className="inline-flex items-center gap-1"><span className="h-px w-2.5 border-t border-dashed border-[#f43f5e]" />Threshold</span><span className="ml-auto normal-case tracking-normal">{tool.name}</span></div>
      </div>
    </TrendPanel>
  );
}
