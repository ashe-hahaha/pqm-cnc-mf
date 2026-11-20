"use client";

import { useEffect, useRef } from "react";
import { SIGNAL_CHANNELS, signalsStore, useSignalsLive, type SignalChannel, type SignalsState } from "@/lib/signalsLive";

const labels: Record<SignalChannel, string> = {
  "spindle.vibration_x": "Vibration · X", "spindle.vibration_y": "Vibration · Y",
  "spindle.vibration_z": "Vibration · Z", "ae.rms": "AE RMS",
};
// Only healthy or in-progress states are shown on the dashboard; stale / empty / unavailable / paused stay silent.
const states: Record<string, string> = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…" };
const PAD_LEFT = 44, PAD_RIGHT = 6, PAD_Y = 6;

/** M4 envelope (bucket extrema, not fabricated raw samples) drawn on a canvas that scrolls smoothly between frames. */
function Scope({ channel }: { channel: SignalChannel }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const state: SignalsState = signalsStore.getSnapshot();
      const series = state.series[channel];
      const dpr = window.devicePixelRatio || 1;
      const width = el.clientWidth, height = el.clientHeight;
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) { el.width = Math.round(width * dpr); el.height = Math.round(height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const plotW = width - PAD_LEFT - PAD_RIGHT, plotH = height - 2 * PAD_Y;
      if (plotW <= 0 || plotH <= 0 || !series.points.length) return;
      const span = Math.max(1, state.end - state.start);
      // Between frames the window keeps advancing at wall-clock speed, capped so a stalled feed does not scroll away.
      const advance = state.status === "live" ? Math.min(performance.now() - state.receivedAt, 1000) : 0;
      const left = state.start + advance, right = state.end + advance;
      let low = Infinity, high = -Infinity;
      for (const p of series.points) { low = Math.min(low, p.min); high = Math.max(high, p.max); }
      if (channel.startsWith("spindle.vibration_")) { low = -1; high = 1; }
      else { const m = Math.max((high - low) * 0.08, Math.abs(high) * 0.01, 1e-6); low -= m; high += m; }
      const x = (t: number) => PAD_LEFT + (t - left) / (right - left || span) * plotW;
      const y = (v: number) => PAD_Y + (high - v) / (high - low) * plotH;
      ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = "#8fa3b5"; ctx.strokeStyle = "#253342"; ctx.lineWidth = 1;
      for (const f of [0, 0.5, 1]) {
        const gy = PAD_Y + f * plotH;
        ctx.beginPath(); ctx.moveTo(PAD_LEFT, gy); ctx.lineTo(PAD_LEFT + plotW, gy); ctx.stroke();
        const v = high - f * (high - low);
        ctx.fillText(channel.startsWith("spindle.vibration_") ? String(v) : v.toPrecision(3), PAD_LEFT - 4, gy + 3);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD_LEFT, 0, plotW, height); ctx.clip();
      ctx.strokeStyle = "#5eb3e8"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of series.points) { const px = Math.round(x(p.t)) + 0.5; ctx.moveTo(px, y(p.min)); ctx.lineTo(px, y(p.max)); }
      ctx.stroke();
      ctx.globalAlpha = 0.5; ctx.lineWidth = 0.7; ctx.beginPath();
      series.points.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.last)) : ctx.moveTo(x(p.t), y(p.last))));
      ctx.stroke();
      ctx.restore();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [channel]);
  return <div>
    <div className="text-[10px] text-[#8fa3b5]">{labels[channel]}</div>
    <canvas ref={canvas} role="img" aria-label={`${labels[channel]} M4 envelope`} className="h-24 w-full rounded border border-[#314254] bg-[#0a1219]" />
  </div>;
}

export function LiveSignalScopes() {
  const { status, machineId, tMax, start } = useSignalsLive();
  const idle = status === "live" && tMax > 0 && Date.now() - tMax > 5000;
  return <div className="mt-3 border-t border-[#2a3a4a]/70 pt-3">
    <div className="flex flex-wrap justify-between gap-2 text-[10px] text-[#8fa3b5]">
      <span>Vibration &amp; AE intensity · {machineId ?? "Machine signals"}</span>
      <span role="status" className={status === "live" && !idle ? "text-emerald-400" : "text-[#8fa3b5]"}>{idle ? "Idle" : states[status] ?? ""}</span>
    </div>
    <div className="mt-2 flex flex-col gap-2">
      {SIGNAL_CHANNELS.map(channel => <Scope key={channel} channel={channel} />)}
    </div>
    {!start && <p className="mt-1 text-[10px] text-[#8fa3b5]">Waiting for signal data…</p>}
    <p className="mt-1 text-[10px] text-[#8fa3b5]">M4 envelope · physical units unconfirmed · machine-wide, not balloon-specific{tMax ? ` · Data: ${new Date(tMax).toLocaleString()}` : ""}</p>
  </div>;
}
