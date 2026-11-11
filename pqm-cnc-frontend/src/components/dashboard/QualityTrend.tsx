"use client";

import { useId, useMemo, useState } from "react";
import type { QualityTrendPoint } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { TrendPanel } from "./TrendPanel";

const TREND_W = 640;
const TREND_H = 210;
const PAD = { l: 40, r: 12, t: 14, b: 30 };

export function QualityTrend({
  balloonCode,
  characteristic,
  points,
  emptyMessage = "No trend series for this balloon.",
}: {
  balloonCode: string | null;
  characteristic?: string;
  points: QualityTrendPoint[];
  emptyMessage?: string;
}) {
  const measured = points.filter((p) => p.qcValue != null);
  const title = balloonCode
    ? `Quality trend · ${balloonCode}${characteristic ? ` · ${characteristic}` : ""}`
    : "Quality trend";

  const last = points.length > 0 ? points[points.length - 1]! : null;
  const ooc =
    last != null &&
    (last.prediction > last.usl || last.prediction < last.lsl);

  return (
    <TrendPanel
      id="trends"
      title={title}
      description={<>{points.length} predicted · mock data{measured.length > 0 ? ` · ${measured.length} measured (reference)` : ""} · LSL–USL band</>}
      status={
        last ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              ooc ? "bg-bad text-[#0b1724]" : "bg-good/90 text-[#0b1724]",
            )}
          >
            {ooc ? "Out of control" : "In control"}
          </span>
        ) : null
      }
    >
      {points.length === 0 ? (
        <p className="mt-2 text-xs text-[#8fa3b5]">
          {emptyMessage}
        </p>
      ) : (
        <TrendChart points={points} />
      )}
    </TrendPanel>
  );
}

function TrendChart({ points }: { points: QualityTrendPoint[] }) {
  const gradId = useId();
  const bandId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const usl = points[0]!.usl;
  const lsl = points[0]!.lsl;
  const mid = (usl + lsl) / 2;

  const layout = useMemo(() => {
    const plotW = TREND_W - PAD.l - PAD.r;
    const plotH = TREND_H - PAD.t - PAD.b;
    const vals = points.flatMap((p) =>
      p.qcValue != null
        ? [p.prediction, p.qcValue, usl, lsl]
        : [p.prediction, usl, lsl],
    );
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const pad = Math.max((rawMax - rawMin) * 0.14, (usl - lsl) * 0.2, 1e-4);
    const min = rawMin - pad;
    const max = rawMax + pad;
    const yOf = (v: number) =>
      PAD.t + plotH - ((v - min) / (max - min || 1)) * plotH;
    const xOf = (i: number) =>
      PAD.l +
      (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);

    const dots = points.map((p, i) => {
      const ooc = p.prediction > usl || p.prediction < lsl;
      const qcOoc =
        p.qcValue != null && (p.qcValue > usl || p.qcValue < lsl);
      return {
        ...p,
        i,
        x: xOf(i),
        yPred: yOf(p.prediction),
        yQc: p.qcValue != null ? yOf(p.qcValue) : null,
        ooc,
        qcOoc,
      };
    });

    const measured = dots
      .filter((d) => d.yQc != null && d.qcValue != null)
      .map((d, mi) => ({
        ...d,
        measureNo: mi + 1,
      }));

    const path = smoothPath(dots.map((d) => ({ x: d.x, y: d.yPred })));
    const last = dots[dots.length - 1]!;
    const area =
      `${path} L${last.x},${PAD.t + plotH}` +
      ` L${dots[0]!.x},${PAD.t + plotH} Z`;

    const yTicks = [lsl, mid, usl].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );

    return {
      dots,
      measured,
      path,
      area,
      yTicks,
      plotW,
      plotH,
      yOf,
    };
  }, [points, usl, lsl, mid]);

  const hover = hoverIdx != null ? layout.dots[hoverIdx] : null;
  const uslY = layout.yOf(usl);
  const lslY = layout.yOf(lsl);
  const decimals = usl - lsl >= 0.1 ? 3 : 4;
  const lastIdx = layout.dots.length - 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
      <svg
        viewBox={`0 0 ${TREND_W} ${TREND_H}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Quality trend with measured reference points"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={bandId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.14} />
            <stop offset="50%" stopColor="#34d399" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0.14} />
          </linearGradient>
        </defs>

        <rect
          x={PAD.l}
          y={PAD.t}
          width={layout.plotW}
          height={layout.plotH}
          fill="#0a1219"
          stroke="rgba(36,49,65,0.9)"
          strokeWidth={1}
          rx={3}
        />

        <rect
          x={PAD.l}
          y={Math.min(uslY, lslY)}
          width={layout.plotW}
          height={Math.max(Math.abs(lslY - uslY), 1)}
          fill={`url(#${bandId})`}
        />

        {layout.yTicks.map((v) => {
          const y = layout.yOf(v);
          return (
            <line
              key={`yg-${v}`}
              x1={PAD.l}
              x2={PAD.l + layout.plotW}
              y1={y}
              y2={y}
              stroke="rgba(148,163,184,0.1)"
              strokeWidth={1}
            />
          );
        })}

        {/* Measured sample vertical guides (reference) */}
        {layout.measured.map((m) => (
          <line
            key={`mv-${m.i}`}
            x1={m.x}
            x2={m.x}
            y1={PAD.t}
            y2={PAD.t + layout.plotH}
            stroke="#fbbf24"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.35}
          />
        ))}

        {/* Measured value horizontal reference lines */}
        {layout.measured.map((m) => (
          <g key={`mh-${m.i}`}>
            <line
              x1={PAD.l}
              x2={PAD.l + layout.plotW}
              y1={m.yQc!}
              y2={m.yQc!}
              stroke="#fbbf24"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.4}
            />
          </g>
        ))}

        <line
          x1={PAD.l}
          y1={uslY}
          x2={PAD.l + layout.plotW}
          y2={uslY}
          stroke="#f43f5e"
          strokeDasharray="5 3"
          strokeWidth={1.2}
          opacity={0.85}
        />
        <line
          x1={PAD.l}
          y1={lslY}
          x2={PAD.l + layout.plotW}
          y2={lslY}
          stroke="#f43f5e"
          strokeDasharray="5 3"
          strokeWidth={1.2}
          opacity={0.85}
        />
        <text
          x={PAD.l + layout.plotW - 2}
          y={uslY - 3}
          textAnchor="end"
          fill="#f43f5e"
          style={{ fontSize: 8, fontWeight: 600 }}
        >
          USL {usl.toFixed(decimals)}
        </text>
        <text
          x={PAD.l + layout.plotW - 2}
          y={lslY + 10}
          textAnchor="end"
          fill="#f43f5e"
          style={{ fontSize: 8, fontWeight: 600 }}
        >
          LSL {lsl.toFixed(decimals)}
        </text>

        {layout.yTicks.map((v) => {
          const y = layout.yOf(v);
          return (
            <text
              key={`yl-${v}`}
              x={PAD.l - 4}
              y={y + 3}
              textAnchor="end"
              fill="#64748b"
              style={{ fontSize: 8 }}
            >
              {v.toFixed(decimals)}
            </text>
          );
        })}

        {/* Prediction (secondary) */}
        <path d={layout.area} fill={`url(#${gradId})`} />
        <path
          d={layout.path}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.85}
        />

        {layout.dots.map((d) => {
          const active = hoverIdx === d.i || d.i === lastIdx;
          const fill = d.ooc ? "#f43f5e" : active ? "#7dd3fc" : "#38bdf8";
          return (
            <g key={`p-${d.i}`}>
              <circle
                cx={d.x}
                cy={d.yPred}
                r={10}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(d.i)}
              />
              <circle
                cx={d.x}
                cy={d.yPred}
                r={active ? 3.5 : 2.25}
                fill={fill}
                stroke="#0b111b"
                strokeWidth={1}
                className="pointer-events-none"
                opacity={d.yQc != null ? 0.55 : 0.9}
              />
            </g>
          );
        })}

        {/* Measured points — primary reference markers */}
        {layout.measured.map((m) => {
          const fill = m.qcOoc ? "#f43f5e" : "#fbbf24";
          const size = 6.5;
          const labelW = 54;
          const labelLeft =
            m.x + 7 + labelW > PAD.l + layout.plotW - 2
              ? m.x - 7 - labelW
              : m.x + 7;
          return (
            <g key={`qc-${m.i}`}>
              <line
                x1={m.x}
                y1={m.yPred}
                x2={m.x}
                y2={m.yQc!}
                stroke={fill}
                strokeWidth={1.25}
                opacity={0.7}
              />
              <polygon
                points={[
                  `${m.x},${m.yQc! - size}`,
                  `${m.x + size},${m.yQc!}`,
                  `${m.x},${m.yQc! + size}`,
                  `${m.x - size},${m.yQc!}`,
                ].join(" ")}
                fill={fill}
                stroke="#0b111b"
                strokeWidth={1.4}
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(m.i)}
              />
              <circle
                cx={m.x}
                cy={m.yQc!}
                r={14}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(m.i)}
              />
              <rect
                x={labelLeft}
                y={m.yQc! - 18}
                width={labelW}
                height={14}
                rx={2}
                fill="#0b111b"
                stroke={fill}
                strokeWidth={1}
                opacity={0.92}
              />
              <text
                x={labelLeft + 3}
                y={m.yQc! - 8}
                fill={fill}
                style={{ fontSize: 8, fontWeight: 700 }}
              >
                M{m.measureNo} {m.qcValue!.toFixed(decimals)}
              </text>
            </g>
          );
        })}

        {layout.dots.map((d) => {
          const show =
            layout.dots.length <= 12 ||
            d.i % 4 === 0 ||
            d.i === lastIdx ||
            d.yQc != null;
          if (!show) return null;
          return (
            <text
              key={`xl-${d.i}`}
              x={d.x}
              y={PAD.t + layout.plotH + 14}
              textAnchor="middle"
              fill={d.yQc != null ? "#fbbf24" : d.i === lastIdx ? "#9eb0c0" : "#64748b"}
              style={{
                fontSize: 8,
                fontWeight: d.yQc != null || d.i === lastIdx ? 700 : 400,
              }}
            >
              #{d.label}
            </text>
          );
        })}
      </svg>
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[132px] rounded-md border border-[#2a3a4a] bg-[#0b111b]/95 px-2 py-1.5 text-[10px] shadow-lg backdrop-blur-sm"
          style={{
            left: `clamp(4px, calc(${(hover.x / TREND_W) * 100}% - 56px), calc(100% - 140px))`,
            top: 4,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[#c5d4e3]">Sample #{hover.label}</span>
            <span
              className={cn(
                "rounded px-1 text-[9px] font-bold uppercase",
                hover.ooc ? "bg-bad/20 text-bad" : "bg-good/20 text-good",
              )}
            >
              {hover.ooc ? "OOC" : "OK"}
            </span>
          </div>
          <div className="mt-1 tabular-nums text-sky-300">
            Pred {hover.prediction.toFixed(decimals)}
          </div>
          {hover.qcValue != null ? (
            <div className="mt-0.5 tabular-nums font-semibold text-[#fbbf24]">
              Measured {hover.qcValue.toFixed(decimals)}
              <span className="ml-1 font-normal text-[#8fa3b5]">
                (Δ{(hover.qcValue - hover.prediction).toFixed(decimals)})
              </span>
            </div>
          ) : (
            <div className="mt-0.5 text-[#6b7c8f]">No measurement</div>
          )}
        </div>
      ) : null}

      {/* Measured reference strip */}
      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.08em] text-[#6b7c8f]">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-2.5 bg-[#38bdf8]" /> Pred
        </span>
        <span className="inline-flex items-center gap-1 normal-case tracking-normal">
          <span
            className="inline-block h-2 w-2 rotate-45 bg-[#fbbf24]"
            aria-hidden
          />
          <span className="uppercase tracking-[0.08em]">Measured</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-px w-2.5 border-t border-dashed border-[#f43f5e]" />{" "}
          Limits
        </span>
        {layout.measured.length > 0 ? (
          <span className="ml-auto flex flex-wrap gap-2 normal-case tracking-normal tabular-nums text-[#c5d4e3]">
            {layout.measured.map((m) => (
              <span key={`ref-${m.i}`}>
                <span className="text-[#6b7c8f]">M{m.measureNo}</span>{" "}
                <span
                  className={cn(
                    "font-semibold",
                    m.qcOoc ? "text-bad" : "text-[#fbbf24]",
                  )}
                >
                  {m.qcValue!.toFixed(decimals)}
                </span>
                <span className="text-[#6b7c8f]"> @#{m.label}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="ml-auto normal-case tracking-normal text-[#6b7c8f]">
            No measured points
          </span>
        )}
      </div>
    </div>
  );
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`;
  if (pts.length === 2) {
    return `M${pts[0]!.x},${pts[0]!.y} L${pts[1]!.x},${pts[1]!.y}`;
  }

  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}
