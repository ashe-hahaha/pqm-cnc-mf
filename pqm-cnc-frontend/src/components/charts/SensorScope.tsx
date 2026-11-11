"use client";

import { useSyncExternalStore } from "react";
import {
  SENSOR_BIAS_V,
  SENSOR_POLL_MS,
  SENSOR_SCOPE_Y_MAX,
  SENSOR_SCOPE_Y_MIN,
  type SensorSample,
} from "@/lib/hfSensors";

const subscribeClock = (cb: () => void) => {
  const id = window.setInterval(cb, SENSOR_POLL_MS);
  return () => window.clearInterval(id);
};

/**
 * Wall clock quantized to the sensor poll interval (0 during SSR/hydration), so
 * scopes refresh like a realtime acquisition without hydration mismatches.
 */
export function useSensorClock(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / SENSOR_POLL_MS) * SENSOR_POLL_MS,
    () => 0,
  );
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Round a raw step up to 1/2/5 × 10^n so axis ticks land on friendly values. */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * 10 ** exp;
}

/** Y range fitted to the data (with headroom) and ticks on nice values. */
function fitRange(samples: SensorSample[]): { min: number; max: number; ticks: number[]; step: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.v < lo) lo = s.v;
    if (s.v > hi) hi = s.v;
  }
  const span = Math.max(hi - lo, 0.05);
  const pad = span * 0.12;
  const step = niceStep((span + 2 * pad) / 4);
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max, ticks, step };
}

/**
 * Oscilloscope-style acquisition plot: time (x) × volts (y).
 * Default: fixed full-scale Y = −5 … +5 V (signal biased ~2.5 V).
 * With `autoScale`, the Y axis follows the data and its ticks adapt.
 */
export function SensorScope({
  samples,
  label,
  warn = false,
  autoScale = false,
  yMin: fixedYMin = SENSOR_SCOPE_Y_MIN,
  yMax: fixedYMax = SENSOR_SCOPE_Y_MAX,
  biasV = SENSOR_BIAS_V,
}: {
  samples: SensorSample[];
  label: string;
  warn?: boolean;
  /** Fit the Y axis to the visible samples instead of the fixed range. */
  autoScale?: boolean;
  yMin?: number;
  yMax?: number;
  biasV?: number;
}) {
  const width = 640;
  const height = 160;
  const padL = 44;
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  if (samples.length < 2) {
    return (
      <div
        className="w-full rounded border border-panel-border bg-[#0e1620]"
        style={{ height }}
      />
    );
  }

  const t0 = samples[0]!.t;
  const t1 = samples[samples.length - 1]!.t;
  const tSpan = Math.max(t1 - t0, 1);
  const fit = autoScale ? fitRange(samples) : null;
  const yMin = fit?.min ?? fixedYMin;
  const yMax = fit?.max ?? fixedYMax;
  const ySpan = yMax - yMin;

  const xOf = (t: number) => padL + ((t - t0) / tSpan) * plotW;
  const yOf = (v: number) => padT + ((yMax - v) / ySpan) * plotH;

  // Downsample path for SVG performance while keeping HF look
  const stride = Math.max(1, Math.floor(samples.length / 900));
  const path: string[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i]!;
    const cmd = path.length === 0 ? "M" : "L";
    path.push(`${cmd}${xOf(s.t).toFixed(2)},${yOf(s.v).toFixed(2)}`);
  }
  // Always include last sample
  const last = samples[samples.length - 1]!;
  path.push(`L${xOf(last.t).toFixed(2)},${yOf(last.v).toFixed(2)}`);

  const stroke = warn ? "#c4921a" : "#5eb3e8";
  const yTicks = fit?.ticks ?? [-5, -2.5, 0, 2.5, 5];
  const yDecimals = fit ? Math.max(0, Math.min(4, -Math.floor(Math.log10(fit.step)))) : 1;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * tSpan);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full rounded border border-panel-border bg-[#0a1219]"
        role="img"
        aria-label={label}
      >
        {/* Grid */}
        {yTicks.map((v) => (
          <line
            key={`y-${v}`}
            x1={padL}
            x2={padL + plotW}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="rgba(148,163,184,0.12)"
            strokeWidth={1}
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`x-${t}`}
            x1={xOf(t)}
            x2={xOf(t)}
            y1={padT}
            y2={padT + plotH}
            stroke="rgba(148,163,184,0.1)"
            strokeWidth={1}
          />
        ))}
        {/* Bias reference 2.5 V */}
        {biasV >= yMin && biasV <= yMax && (
          <line
            x1={padL}
            x2={padL + plotW}
            y1={yOf(biasV)}
            y2={yOf(biasV)}
            stroke="rgba(212,160,23,0.45)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        <path
          d={path.join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={1.05}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Y labels */}
        {yTicks.map((v) => (
          <text
            key={`yl-${v}`}
            x={padL - 6}
            y={yOf(v) + 3}
            textAnchor="end"
            className="fill-[#8fa3b5]"
            style={{ fontSize: 9 }}
          >
            {v.toFixed(yDecimals)}
          </text>
        ))}
        <text
          x={12}
          y={padT + plotH / 2}
          textAnchor="middle"
          className="fill-[#6b7c8f]"
          style={{ fontSize: 9 }}
          transform={`rotate(-90 12 ${padT + plotH / 2})`}
        >
          Volt
        </text>
        {/* X labels */}
        <text
          x={padL}
          y={height - 8}
          className="fill-[#8fa3b5]"
          style={{ fontSize: 9 }}
        >
          {formatClock(t0)}
        </text>
        <text
          x={padL + plotW}
          y={height - 8}
          textAnchor="end"
          className="fill-[#8fa3b5]"
          style={{ fontSize: 9 }}
        >
          {formatClock(t1)}
        </text>
        <text
          x={padL + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          className="fill-[#6b7c8f]"
          style={{ fontSize: 9 }}
        >
          time
        </text>
      </svg>
    </div>
  );
}
