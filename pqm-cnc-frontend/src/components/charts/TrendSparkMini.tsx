"use client";

import { useId, useState } from "react";

/** Match engineering units on the Process context readout. */
function formatTrendValue(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Compact process-parameter trend — visual language aligned with
 * oee-platform TrendSpark / IntradayTrendChart (grid, sky stroke, amber points).
 */
export function TrendSparkMini({
  series,
  label,
  /** Fixed x-domain so streaming points grow left → right instead of stretching. */
  capacity,
  animate = true,
}: {
  series: number[];
  label: string;
  capacity?: number;
  animate?: boolean;
}) {
  const gradId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const w = 104;
  const h = 36;
  const padL = 2;
  const padR = 2;
  const padT = 4;
  const padB = 4;

  if (series.length < 2) {
    return (
      <div
        className="h-9 w-[104px] shrink-0 rounded border border-[#2a3a4a] bg-[#0e1620]"
        aria-hidden
      />
    );
  }

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const min = Math.min(...series) * 0.97;
  const max = Math.max(...series) * 1.03;
  const span = max - min || 1;
  const xDenom = Math.max((capacity ?? series.length) - 1, 1);

  const coords = series.map((v, i) => {
    const x = padL + (i / xDenom) * plotW;
    const y = padT + plotH - ((v - min) / span) * plotH;
    return { x, y, v, i };
  });

  // Hybrid path: smooth polyline for minor noise; vertical steps only on real level jumps.
  const jumpPx = Math.max(2.5, plotH * 0.12);
  const path = coords
    .map((c, i) => {
      if (i === 0) return `M${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      const prev = coords[i - 1]!;
      if (Math.abs(c.y - prev.y) < jumpPx) {
        return `L${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      }
      return `L${c.x.toFixed(1)},${prev.y.toFixed(1)} L${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    })
    .join(" ");

  const hover = hoverIdx != null ? coords[hoverIdx] : null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible rounded border border-[#2a3a4a] bg-[#0e1620]"
      role="img"
      aria-label={`${label} trend`}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75].map((t) => {
        const y = padT + plotH - t * plotH;
        return (
          <line
            key={t}
            x1={padL}
            x2={w - padR}
            y1={y}
            y2={y}
            stroke="rgba(148,163,184,0.15)"
            strokeWidth={1}
          />
        );
      })}

      <path
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={animate ? "trend-draw" : undefined}
      />

      {coords.map((c) => (
        <circle
          key={c.i}
          cx={c.x}
          cy={c.y}
          r={hoverIdx === c.i ? 3.5 : c.i === coords.length - 1 ? 2.8 : 2}
          fill={
            hoverIdx === c.i || c.i === coords.length - 1 ? "#fbbf24" : "#38bdf8"
          }
          stroke="#0b1724"
          strokeWidth={1}
          className="cursor-pointer"
          onMouseEnter={() => setHoverIdx(c.i)}
        >
          <title>{`${label}: ${formatTrendValue(c.v)}`}</title>
        </circle>
      ))}

      {hover ? (
        <text
          x={Math.min(Math.max(hover.x, 18), w - 18)}
          y={Math.max(hover.y - 6, 9)}
          textAnchor="middle"
          fill="#fbbf24"
          style={{ fontSize: 8 }}
        >
          {formatTrendValue(hover.v)}
        </text>
      ) : null}
    </svg>
  );
}
