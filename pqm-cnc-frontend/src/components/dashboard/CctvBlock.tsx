"use client";

import { useEffect, useRef, useState } from "react";
import { useMseStream } from "@/lib/useMseStream";
import { Panel } from "./Panel";

const POLL_MS = 1500;
const STALE_MS = 10000;
const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

/**
 * Machine CCTV. With a go2rtc stream configured it plays live video; otherwise, or while the video is not
 * running, it shows a still picture refreshed about every 1.5 s through the backend (which holds the NVR credentials).
 */
export function CctvBlock({ title = "Machine CCTV · V61", streamUrl = process.env.NEXT_PUBLIC_CCTV_STREAM_URL }: {
  title?: string; streamUrl?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoLive = useMseStream(streamUrl, videoRef);
  const [frame, setFrame] = useState<{ url: string; capturedAt: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (videoLive) return;  // the picture is only needed while there is no video
    let active = true;
    let timer: number | undefined;
    let current: string | null = null;
    const controller = new AbortController();
    const load = async () => {
      if (!document.hidden) {
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
          const response = await fetch(`${base}/api/cctv/snapshot`, { signal, cache: "no-store" });
          if (!response.ok) throw new Error(`CCTV unavailable (${response.status})`);
          const url = URL.createObjectURL(await response.blob());
          if (!active) { URL.revokeObjectURL(url); return; }
          if (current) URL.revokeObjectURL(current);
          current = url;
          setFrame({ url, capturedAt: response.headers.get("X-Captured-At") ?? new Date().toISOString() });
          setFailed(false);
        } catch {
          if (active) setFailed(true);
        }
      }
      if (active) timer = window.setTimeout(load, POLL_MS);  // sequential: never two requests in flight
    };
    void load();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
      window.clearInterval(tick);
      if (current) URL.revokeObjectURL(current);
    };
  }, [videoLive]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  const capturedMs = frame?.capturedAt ? new Date(frame.capturedAt).getTime() : NaN;
  const stale = Number.isFinite(capturedMs) && now - capturedMs > STALE_MS;
  const status = videoLive ? "Live video" : failed ? "Unavailable · retrying" : !frame ? "Connecting…" : stale ? "Stale" : "Live";
  const statusColor = !videoLive && (failed || stale) ? "text-amber-400" : "text-[#8296a8]";
  return <>
    <Panel title={title} titleRight={<span role="status" className={`text-[10px] ${statusColor}`}>{status}</span>}>
      <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#385064] bg-[#0a141e]">
        <video ref={videoRef} muted playsInline autoPlay aria-label="Machine CCTV live video"
          className={`absolute inset-0 h-full w-full object-cover ${videoLive ? "" : "hidden"}`} />
        {videoLive ? null : frame ? <button className="absolute inset-0 h-full w-full" onClick={() => setExpanded(true)} aria-label="Enlarge CCTV picture">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frame.url} alt="Machine CCTV live picture" className="h-full w-full object-cover" />
        </button> : <div className="p-6 text-center"><span className="text-3xl text-[#6294b3]">▣</span>
          <p className="mt-3 text-sm text-[#bbcfde]">{failed ? "CCTV picture unavailable" : "Waiting for CCTV picture…"}</p></div>}
      </div>
      <div className="mt-2 shrink-0 text-[11px] text-[#8296a8]">
        {videoLive ? <p>Live video</p> : frame && Number.isFinite(capturedMs)
          ? <p>Updated <time dateTime={new Date(capturedMs).toISOString()}>{new Date(capturedMs).toLocaleTimeString()}</time>{failed ? " · last picture shown" : ""}</p>
          : <p>The picture refreshes about every 1.5 seconds.</p>}
      </div>
    </Panel>
    {expanded && frame && !videoLive && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6" role="dialog" aria-modal="true" aria-label="CCTV picture" onClick={() => setExpanded(false)}>
      <button autoFocus className="absolute right-6 top-6 rounded-lg border border-[#314254] bg-[#152738] px-3 py-2 text-xs text-[#a6bacb]" onClick={() => setExpanded(false)}>Close ×</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame.url} alt="Machine CCTV enlarged" className="max-h-[85vh] max-w-full object-contain" />
    </div>}
  </>;
}
