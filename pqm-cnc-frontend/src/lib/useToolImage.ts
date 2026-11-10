"use client";

import { useEffect, useState } from "react";

export type ToolImage = {
  captureId: string;
  machineId: string;
  toolNo: string;
  timestampUtc: string;
  receivedAt: string;
  receivedSequence: number;
  imageUrl: string;
  inspectionResult: string | null;
};

export function useToolImage() {
  const [image, setImage] = useState<ToolImage | null>(null);
  const [status, setStatus] = useState("connecting");
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    let active = true;
    let revision = 0;
    let refreshing = false;
    const controller = new AbortController();
    const accept = (data: ToolImage) => {
      if (!active || !data || typeof data.receivedSequence !== "number" || !/^\/api\/tool-images\/[0-9a-f-]+\/image$/.test(data.imageUrl)) return;
      setImage(previous => previous && previous.receivedSequence > data.receivedSequence ? previous : { ...data, imageUrl: `${base}${data.imageUrl}` });
    };
    const source = new EventSource(`${base}/api/tool-images/events`);
    const refresh = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      const startRevision = revision;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        const response = await fetch(`${base}/api/tool-images/latest`, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Image source unavailable");
        const latest = await response.json();
        if (active) {
          if (latest.image) accept(latest.image);
          if (startRevision === revision) setStatus(latest.status.state);
        }
      } catch {
        if (active && startRevision === revision) setStatus("unavailable");
      } finally {
        refreshing = false;
      }
    };
    source.onopen = () => { void refresh(); };
    source.addEventListener("image", event => {
      try { accept(JSON.parse((event as MessageEvent).data)); }
      catch { if (active) setStatus("unavailable"); }
    });
    source.addEventListener("status", event => {
      revision += 1;
      try { if (active) setStatus(JSON.parse((event as MessageEvent).data).state); }
      catch { if (active) setStatus("unavailable"); }
    });
    source.onerror = () => { revision += 1; if (active) setStatus("reconnecting"); };
    const refreshVisible = () => { void refresh(); };
    const timer = window.setInterval(refreshVisible, 5000);
    document.addEventListener("visibilitychange", refreshVisible);
    refreshVisible();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      controller.abort();
      source.close();
    };
  }, []);
  return { image, status };
}
