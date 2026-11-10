"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { DrawingBalloon, BalloonRisk } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { riskLabel } from "./opsStyles";

type Camera = { x: number; y: number; scale: number };

const MIN_SCALE = 0.35;
const MAX_SCALE = 4;

/** Live “in cut” cue — purple, distinct from warn gold (#eab308). */
const MACHINING_RING = "#a78bfa";
const MACHINING_GLOW = "rgba(167,139,250,0.45)";
const MACHINING_GLOW_SOFT = "rgba(167,139,250,0.35)";

/** Balloon diameter in drawing (world) pixels — zooms with the page. */
const BALLOON_WORLD_PX = 22;

const RISK_FILL: Record<BalloonRisk, string> = {
  pass: "#34d399",
  warning: "#eab308",
  high_risk: "#f43f5e",
  not_machined: "#64748b",
};

/**
 * Pan/zoom stage: drawing uses CSS camera transform; balloons are HTML overlays
 * positioned in screen space and sized by camera.scale so they zoom with the
 * page and stay sharp (no counter-scale / nested CSS shrink blur).
 */
export function DrawingStage({
  imageSrc,
  imageLabel,
  worldWidth = 1000,
  worldHeight = 1000,
  balloons,
  selectedId,
  machiningId,
  adjustMode,
  busyLabel,
  onSelect,
  onMove,
  onAdd,
}: {
  imageSrc: string | null;
  imageLabel: string;
  worldWidth?: number;
  worldHeight?: number;
  balloons: DrawingBalloon[];
  selectedId: string | null;
  /** Balloon currently under cut in the machining sim. */
  machiningId?: string | null;
  adjustMode: boolean;
  busyLabel?: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, xPct: number, yPct: number) => void;
  /** Design mode: click empty stage to place balloon(s). */
  onAdd?: (xPct: number, yPct: number) => void;
}) {
  const worldW = worldWidth > 0 ? worldWidth : 1000;
  const worldH = worldHeight > 0 ? worldHeight : 1000;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ w: 640, h: 420 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({ active: false, pointerId: null, lastX: 0, lastY: 0 });
  const balloonDrag = useRef<{ id: string; pointerId: number } | null>(null);
  const addClick = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const applyFit = useCallback(() => {
    const el = viewportRef.current;
    const vw = el?.clientWidth || viewportSize.w;
    const vh = el?.clientHeight || viewportSize.h;
    setCamera(
      fitCamera({ minX: 0, minY: 0, maxX: worldW, maxY: worldH }, vw, vh),
    );
  }, [viewportSize.w, viewportSize.h, worldW, worldH]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setViewportSize({ w, h });
      setCamera(
        fitCamera({ minX: 0, minY: 0, maxX: worldW, maxY: worldH }, w, h),
      );
    });
    ro.observe(el);
    applyFit();
    return () => ro.disconnect();
  }, [applyFit, imageSrc, worldW, worldH]);

  function onWheel(e: ReactWheelEvent) {
    // Zoom only with Ctrl+Shift; otherwise let the event bubble for page scroll.
    if (!isNavChord(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCamera((cam) => {
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, cam.scale * factor),
      );
      const worldX = (mx - cam.x) / cam.scale;
      const worldY = (my - cam.y) / cam.scale;
      return {
        scale: nextScale,
        x: mx - worldX * nextScale,
        y: my - worldY * nextScale,
      };
    });
  }

  function clientToPct(
    clientX: number,
    clientY: number,
  ): { xPct: number; yPct: number } {
    const el = viewportRef.current;
    if (!el) return { xPct: 50, yPct: 50 };
    const rect = el.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const wx = (vx - camera.x) / camera.scale;
    const wy = (vy - camera.y) / camera.scale;
    return {
      xPct: clamp((wx / worldW) * 100, 0, 100),
      yPct: clamp((wy / worldH) * 100, 0, 100),
    };
  }

  const balloonScreenPx = Math.max(8, BALLOON_WORLD_PX * camera.scale);
  const [navHeld, setNavHeld] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      setNavHeld((e.ctrlKey || e.metaKey) && e.shiftKey);
    }
    function onBlur() {
      setNavHeld(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-[#243141] bg-[#0a1219]",
        navHeld && "touch-none cursor-grab active:cursor-grabbing",
        adjustMode && onAdd && !navHeld && "cursor-crosshair",
      )}
      onWheel={onWheel}
      onPointerDown={(e: ReactPointerEvent) => {
        if (e.button !== 0 || balloonDrag.current) return;
        if ((e.target as Element).closest("[data-balloon]")) return;
        if ((e.target as Element).closest("[data-hud]")) return;
        // Pan only while Ctrl+Shift is held.
        if (isNavChord(e)) {
          e.preventDefault();
          addClick.current = null;
          dragRef.current = {
            active: true,
            pointerId: e.pointerId,
            lastX: e.clientX,
            lastY: e.clientY,
          };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
        // Design: click empty area to place balloon(s).
        if (adjustMode && onAdd) {
          addClick.current = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
          };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e: ReactPointerEvent) => {
        if (balloonDrag.current?.pointerId === e.pointerId) {
          const { xPct, yPct } = clientToPct(e.clientX, e.clientY);
          onMove(balloonDrag.current.id, xPct, yPct);
          return;
        }
        const pending = addClick.current;
        if (pending?.pointerId === e.pointerId) {
          const dx = e.clientX - pending.x;
          const dy = e.clientY - pending.y;
          if (dx * dx + dy * dy > 36) addClick.current = null;
          return;
        }
        const d = dragRef.current;
        if (!d.active || d.pointerId !== e.pointerId) return;
        if (!isNavChord(e)) {
          d.active = false;
          d.pointerId = null;
          return;
        }
        const dx = e.clientX - d.lastX;
        const dy = e.clientY - d.lastY;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        setCamera((cam) => ({ ...cam, x: cam.x + dx, y: cam.y + dy }));
      }}
      onPointerUp={(e) => {
        if (balloonDrag.current?.pointerId === e.pointerId) {
          balloonDrag.current = null;
        }
        if (dragRef.current.pointerId === e.pointerId) {
          dragRef.current.active = false;
          dragRef.current.pointerId = null;
        }
        const pending = addClick.current;
        if (pending?.pointerId === e.pointerId) {
          addClick.current = null;
          if (onAdd) {
            const { xPct, yPct } = clientToPct(e.clientX, e.clientY);
            onAdd(xPct, yPct);
          }
        }
      }}
      onDoubleClick={(e) => {
        if (isNavChord(e)) applyFit();
      }}
      onContextMenu={(e) => {
        if (isNavChord(e)) e.preventDefault();
      }}
    >
      {/* Drawing only — CSS camera. Balloons are a separate sharp overlay. */}
      <div
        className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={{
          width: worldW,
          height: worldH,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        }}
      >
        <div className="absolute inset-0 bg-white">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt={imageLabel}
              className="pointer-events-none block h-full w-full select-none"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#0a1219] text-sm text-[#6b7c8f]">
              Select a drawing
            </div>
          )}
        </div>
      </div>

      {/* Screen-space balloons: size ∝ zoom, text drawn at final px → sharp */}
      {balloons.map((b) => {
        const wx = (b.xPct / 100) * worldW;
        const wy = (b.yPct / 100) * worldH;
        const left = camera.x + wx * camera.scale;
        const top = camera.y + wy * camera.scale;
        const selected = b.id === selectedId;
        const machining = b.id === machiningId;
        const fill = RISK_FILL[b.risk];
        const label = b.code.replace(/^B/i, "");
        const fontPx = Math.max(7, balloonScreenPx * 0.42);

        return (
          <button
            key={b.id}
            type="button"
            data-balloon={b.id}
            data-machining={machining ? "true" : undefined}
            title={`${b.code} · ${b.characteristic} · ${riskLabel[b.risk]}${
              machining ? " · machining now" : ""
            }${adjustMode ? " · drag" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(b.id);
              if (!adjustMode) return;
              balloonDrag.current = { id: b.id, pointerId: e.pointerId };
              viewportRef.current?.setPointerCapture(e.pointerId);
            }}
            className={cn(
              "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-bold touch-none",
              adjustMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              selected &&
                !machining &&
                "ring-2 ring-[#3d8fd1] ring-offset-1 ring-offset-[#0a1219]",
              machining &&
                "z-20 ring-2 ring-[#a78bfa] ring-offset-2 ring-offset-[#0a1219] animate-pulse",
            )}
            style={{
              left,
              top,
              width: balloonScreenPx,
              height: balloonScreenPx,
              backgroundColor: fill,
              borderColor: machining
                ? MACHINING_RING
                : selected
                  ? "#ffffff"
                  : "rgba(255,255,255,0.35)",
              borderWidth: machining || selected ? 2 : 1,
              color: b.risk === "not_machined" ? "#cbd5e1" : "#0b111b",
              fontSize: fontPx,
              boxShadow: machining
                ? `0 0 0 ${Math.max(3, balloonScreenPx * 0.35)}px ${MACHINING_GLOW}, 0 0 ${Math.max(8, balloonScreenPx * 0.7)}px ${MACHINING_GLOW_SOFT}`
                : `0 0 0 ${Math.max(2, balloonScreenPx * 0.25)}px ${fill}55`,
            }}
          >
            {label}
          </button>
        );
      })}

      {busyLabel != null ? (
        <div className="pointer-events-none absolute inset-0 z-20 bg-[#0a1219]/55" />
      ) : null}

      <div data-hud className="absolute bottom-3 right-3 z-20 flex gap-1">
        <HudBtn
          label="+"
          onClick={() =>
            setCamera((c) => ({
              ...c,
              scale: Math.min(MAX_SCALE, c.scale * 1.15),
            }))
          }
        />
        <HudBtn
          label="−"
          onClick={() =>
            setCamera((c) => ({
              ...c,
              scale: Math.max(MIN_SCALE, c.scale / 1.15),
            }))
          }
        />
        <HudBtn label="Fit" onClick={() => applyFit()} />
      </div>
    </div>
  );
}

function HudBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded border border-[#243141] bg-[#0b111b]/90 px-2 py-1 text-xs text-[#9eb0c0] hover:border-[#3d8fd1]/50 hover:text-foreground"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function fitCamera(
  frame: { minX: number; minY: number; maxX: number; maxY: number },
  vw: number,
  vh: number,
  padding = 16,
): Camera {
  const fw = frame.maxX - frame.minX || 1;
  const fh = frame.maxY - frame.minY || 1;
  const scale = Math.min(
    (vw - padding * 2) / fw,
    (vh - padding * 2) / fh,
    MAX_SCALE,
  );
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  return {
    scale: Math.max(scale, 0.05),
    x: vw / 2 - cx * scale,
    y: vh / 2 - cy * scale,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Zoom / pan / fit require Ctrl+Shift together. */
function isNavChord(e: {
  ctrlKey: boolean;
  metaKey?: boolean;
  shiftKey: boolean;
}): boolean {
  return (e.ctrlKey || Boolean(e.metaKey)) && e.shiftKey;
}
