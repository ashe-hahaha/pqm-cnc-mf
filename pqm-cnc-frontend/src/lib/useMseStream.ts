"use client";

import { useEffect, useState, type RefObject } from "react";

const CODECS = ["avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0"];
const SILENCE_MS = 6000;     // no data for this long = the stream is dead, reconnect
const KEEP_BUFFER_S = 15;    // seconds of video kept behind the live edge
const MAX_LAG_S = 3;         // jump to the live edge when playback falls behind by more than this

/** A path such as /cctv/ws becomes ws(s)://this-host/cctv/ws; full ws:// URLs are used as they are. */
export function resolveStreamUrl(url: string) {
  if (!url.startsWith("/")) return url;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`;
}

function supportedCodecs() {
  return CODECS.filter(codec => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)).join(",");
}

/**
 * Plays a go2rtc stream in a <video> through Media Source Extensions over a WebSocket.
 * `live` is true only while video frames are arriving; it reconnects by itself and pauses while the page is hidden.
 */
export function useMseStream(url: string | undefined, videoRef: RefObject<HTMLVideoElement | null>) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!url || typeof MediaSource === "undefined" || typeof WebSocket === "undefined") return;
    let stopped = false;
    let retries = 0;
    let retryTimer: number | undefined;
    let teardown = () => {};

    const connect = () => {
      const video = videoRef.current;
      if (stopped || document.hidden || !video) return;
      const ms = new MediaSource();
      const objectUrl = URL.createObjectURL(ms);
      const ws = new WebSocket(resolveStreamUrl(url));
      ws.binaryType = "arraybuffer";
      let sb: SourceBuffer | undefined;
      let queue: Uint8Array[] = [];
      let lastData = Date.now();
      let sourceOpen = false;
      let socketOpen = false;
      let done = false;

      const fail = () => {
        if (done) return;
        end();
        if (stopped) return;
        retryTimer = window.setTimeout(connect, Math.min(15000, 1500 * 2 ** retries++));
      };
      const end = () => {
        done = true;
        window.clearInterval(watch);
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
        setLive(false);
      };
      teardown = end;

      const hello = () => {
        if (sourceOpen && socketOpen) ws.send(JSON.stringify({ type: "mse", value: supportedCodecs() }));
      };
      const pump = () => {
        if (done || !sb || sb.updating || ms.readyState !== "open") return;
        try {
          if (queue.length) {
            const total = queue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const joined = new Uint8Array(total);
            let offset = 0;
            for (const chunk of queue) { joined.set(chunk, offset); offset += chunk.byteLength; }
            queue = [];
            sb.appendBuffer(joined);
          } else if (sb.buffered.length) {
            const trimTo = sb.buffered.end(sb.buffered.length - 1) - KEEP_BUFFER_S;
            if (trimTo > sb.buffered.start(0)) sb.remove(sb.buffered.start(0), trimTo);
          }
        } catch {
          fail();
        }
      };

      ms.addEventListener("sourceopen", () => { sourceOpen = true; hello(); }, { once: true });
      video.src = objectUrl;
      ws.onopen = () => { socketOpen = true; hello(); };
      ws.onerror = fail;
      ws.onclose = fail;
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          let message: { type?: string; value?: string };
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === "mse" && message.value && !sb) {
            try {
              sb = ms.addSourceBuffer(message.value);
              sb.mode = "segments";
              sb.addEventListener("updateend", pump);
            } catch { fail(); }
          } else if (message.type === "error") {
            fail();
          }
          return;
        }
        lastData = Date.now();
        queue.push(new Uint8Array(event.data as ArrayBuffer));
        retries = 0;
        setLive(true);
        pump();
        if (video.paused) void video.play().catch(() => {});
      };
      const watch = window.setInterval(() => {
        if (Date.now() - lastData > SILENCE_MS) { fail(); return; }
        const ranges = video.buffered;
        if (ranges.length) {
          const edge = ranges.end(ranges.length - 1);
          if (edge - video.currentTime > MAX_LAG_S) video.currentTime = edge - 0.5;
        }
      }, 1000);
    };

    const onVisibility = () => {
      window.clearTimeout(retryTimer);
      teardown();
      teardown = () => {};
      if (!document.hidden) { retries = 0; connect(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    connect();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(retryTimer);
      teardown();
    };
  }, [url, videoRef]);
  return live;
}
