"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native two-axis resizing avoids coupling each tool block to a shared column width. */
export function ResizableToolBlock({ id, width, height, locked = false, fillWidth = false, children }: {
  id: string; width: number; height: number; locked?: boolean; fillWidth?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width, height });
  const [ready, setReady] = useState(false);
  const key = `pqm.toolWear.block:${id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) && saved.width >= (fillWidth ? 1 : 200) && saved.height >= 160) setSize(saved);
    } catch { /* use defaults */ }
    setReady(true);
  }, [key, fillWidth]);
  useEffect(() => {
    if (!ready || !ref.current || typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      if (first) { first = false; return; }
      const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      if (next.width < (fillWidth ? 1 : 200) || next.height < 160) return;
      setSize((prev) => prev.width === next.width && prev.height === next.height ? prev : next);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [key, ready, fillWidth]);
  return <div ref={ref} data-tool-block={id} title={locked ? undefined : fillWidth ? "Drag the bottom edge to resize height; use the column divider for width" : "Drag the bottom-right corner to resize width and height"}
    style={{ width: fillWidth ? "100%" : `min(100%, ${size.width}px)`, height: size.height, minWidth: fillWidth ? 0 : 200, minHeight: 160, maxWidth: "100%", flexShrink: 0, resize: locked ? "none" : fillWidth ? "vertical" : "both", overflow: "hidden", position: "relative" }}>
    <div className="h-full min-h-0" style={{ paddingBottom: locked ? 0 : 4 }}>{children}</div>
    {!locked && <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 text-xs leading-none text-[#7eb6e8]">◢</span>}
  </div>;
}
