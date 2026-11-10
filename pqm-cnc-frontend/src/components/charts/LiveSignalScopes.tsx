"use client";

import { useEffect, useState } from "react";

type Point = { t: string; min: number; max: number; first: number; last: number };
type Wave = { channel: string; bucket_ms: number; points: Point[] };
type Batch = { machine_id: string; start: string; end: string; t_max: string; channels: Wave[] };
const labels: Record<string, string> = {
  "spindle.vibration_x": "Vibration · X", "spindle.vibration_y": "Vibration · Y",
  "spindle.vibration_z": "Vibration · Z", "ae.rms": "AE RMS",
};
const states: Record<string, string> = {
  connecting: "Connecting…", live: "Live", stale: "Data not updating / delayed",
  empty: "No signal samples", unavailable: "Source unavailable · retrying",
  reconnecting: "Connection lost · reconnecting", paused: "Paused while page is hidden",
};

/** M4 envelope: bucket extrema are not fabricated raw samples. Units await upstream confirmation. */
function Envelope({ wave, batch }: { wave: Wave; batch: Batch }) {
  if (!wave.points.length) return <div className="p-4 text-xs text-[#8fa3b5]">No samples for this channel.</div>;
  let low = Infinity, high = -Infinity;
  for (const p of wave.points) { low = Math.min(low, p.min); high = Math.max(high, p.max); }
  const margin = Math.max((high - low) * 0.08, Math.abs(high) * 0.01, 0.000001);
  low -= margin; high += margin;
  const isVibration = wave.channel.startsWith("spindle.vibration_");
  if (isVibration) { low = -1; high = 1; }
  const start = Date.parse(batch.start), span = Math.max(1, Date.parse(batch.end) - start);
  const x = (t: string) => 65 + (Date.parse(t) - start) / span * 560;
  const y = (v: number) => 12 + (high - v) / (high - low) * 110;
  const path = wave.points.map(p => `M${x(p.t).toFixed(2)},${y(p.min).toFixed(2)}V${y(p.max).toFixed(2)}`).join(" ");
  const trend = wave.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)},${y(p.last).toFixed(2)}`).join(" ");
  return <svg viewBox="0 0 640 158" role="img" aria-label={`${labels[wave.channel]} M4 envelope`} className="w-full rounded border border-[#314254] bg-[#0a1219]">
    {[0, 0.5, 1].map(f => <g key={f}>
      <line x1="65" x2="625" y1={12 + f * 110} y2={12 + f * 110} stroke="#253342" />
      <text x="60" y={16 + f * 110} textAnchor="end" fill="#8fa3b5" fontSize="9">{isVibration ? high - f * (high - low) : (high - f * (high - low)).toPrecision(3)}</text>
    </g>)}
    <svg x="65" y="12" width="560" height="110" viewBox="65 12 560 110" overflow="hidden">
      <path d={path} stroke="#5eb3e8" strokeWidth="1" fill="none" />
      <path d={trend} stroke="#5eb3e8" strokeWidth="0.7" fill="none" opacity="0.5" />
    </svg>
    <text x="65" y="146" fill="#8fa3b5" fontSize="9">{new Date(batch.start).toLocaleTimeString()}</text>
    <text x="625" y="146" textAnchor="end" fill="#8fa3b5" fontSize="9">{new Date(batch.end).toLocaleTimeString()}</text>
  </svg>;
}

export function LiveSignalScopes() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [state, setState] = useState("connecting");
  const [selected, setSelected] = useState("spindle.vibration_x");
  useEffect(() => {
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastEvent = Date.now();
    const stop = () => { source?.close(); source = null; clearInterval(watchdog); };
    const start = () => {
      stop();
      if (document.hidden) { setState("paused"); return; }
      setState("connecting");
      const base = process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000";
      const machine = process.env.NEXT_PUBLIC_SIGNALS_MACHINE_ID;
      source = new EventSource(`${base.replace(/\/$/, "")}/api/signals/stream${machine ? `?machine_id=${encodeURIComponent(machine)}` : ""}`);
      source.addEventListener("signals", event => {
        lastEvent = Date.now();
        try { setBatch(JSON.parse((event as MessageEvent).data)); }
        catch { setState("unavailable"); }
      });
      source.addEventListener("status", event => {
        lastEvent = Date.now();
        try { setState(JSON.parse((event as MessageEvent).data).state); }
        catch { setState("unavailable"); }
      });
      source.onerror = () => setState("reconnecting");
      lastEvent = Date.now();
      watchdog = setInterval(() => { if (Date.now() - lastEvent > 20000) setState("reconnecting"); }, 3000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => { stop(); document.removeEventListener("visibilitychange", start); };
  }, []);
  const wave = batch?.channels.find(c => c.channel === selected);
  return <div className="mt-3 border-t border-[#2a3a4a]/70 pt-3">
    <div className="flex flex-wrap justify-between gap-2 text-[10px] text-[#8fa3b5]">
      <span>Vibration &amp; AE intensity · {batch?.machine_id ?? "Machine signals"}</span>
      <span role="status" className={state === "live" ? "text-emerald-400" : "text-amber-400"}>{states[state] ?? state}</span>
    </div>
    <label className="my-2 flex justify-between gap-2 text-xs text-[#8fa3b5]">Signal channel
      <select aria-label="Signal channel" value={selected} onChange={e => setSelected(e.target.value)} className="rounded border border-[#314254] bg-[#0c1722] text-[#c6d7e4]">
        {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    {batch && wave ? <Envelope wave={wave} batch={batch} /> : <div className="flex h-40 items-center justify-center rounded border border-[#314254] text-xs text-[#8fa3b5]">Waiting for signal data…</div>}
    <p className="mt-1 text-[10px] text-[#8fa3b5]">M4 envelope · physical units unconfirmed · machine-wide, not balloon-specific{batch ? ` · Data: ${new Date(batch.t_max).toLocaleString()}` : ""}</p>
  </div>;
}
