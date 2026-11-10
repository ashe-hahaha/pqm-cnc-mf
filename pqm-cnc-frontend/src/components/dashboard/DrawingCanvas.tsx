"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawingPageImage } from "@/domain/drawingPages";
import type { DrawingBalloon } from "@/domain/opsDashboard";
import {
  loadBalloonLayout,
  persistBalloonLayout,
} from "@/lib/balloonLayoutClient";
import {
  type BalloonEditMode,
  readBalloonEditMode,
  readBalloonLayoutLocal,
  writeBalloonEditMode,
} from "@/lib/drawingBalloonCache";
import { createManualBalloons } from "@/lib/manualBalloons";
import { pdfToPageImages } from "@/lib/pdfViewer";
import { cn } from "@/lib/format";
import {
  type ActiveDrawing,
  drawingFileUrl,
} from "./DrawingSourcePicker";
import { DrawingStage } from "./DrawingStage";

type Phase = "idle" | "converting" | "ready" | "error";

const LEGEND = [
  { color: "#34d399", label: "Pass" },
  { color: "#eab308", label: "Warn" },
  { color: "#f43f5e", label: "Risk" },
  { color: "#64748b", label: "N/M" },
  { color: "#a78bfa", label: "In cut", ring: true },
] as const;

/**
 * Tech-drawing viewer — PDF/image stage with design / lock balloon editing.
 */
export function DrawingCanvas({
  seedBalloons,
  balloons,
  allBalloons,
  selectedId,
  machiningId = null,
  onSelect,
  drawing,
  page,
  onPageChange,
  onBalloonsChange,
}: {
  seedBalloons: DrawingBalloon[];
  balloons: DrawingBalloon[];
  allBalloons: DrawingBalloon[];
  selectedId: string | null;
  /** Balloon currently under cut — amber pulse on the map. */
  machiningId?: string | null;
  onSelect: (id: string) => void;
  drawing: ActiveDrawing | null;
  page: number;
  onPageChange: (page: number) => void;
  onBalloonsChange: (allPages: DrawingBalloon[] | null) => void;
}) {
  return (
    <section
      id="drawing"
      className="flex h-full min-h-0 flex-col rounded-xl border border-[#243141] bg-[#121a24] text-foreground shadow-[0_1px_0_rgba(255,255,255,0.02)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#243141] px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9eb0c0]">
          Drawing – Quality Balloon Map
        </h2>
        <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.08em] text-[#6b7c8f]">
          {LEGEND.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  "ring" in l && l.ring && "ring-2 ring-[#a78bfa]/80 ring-offset-1 ring-offset-[#121a24]",
                )}
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <DrawingSession
        key={drawing?.relPath ?? "schematic"}
        seedBalloons={seedBalloons}
        balloons={balloons}
        allBalloons={allBalloons}
        selectedId={selectedId}
        machiningId={machiningId}
        onSelect={onSelect}
        drawing={drawing}
        page={page}
        onPageChange={onPageChange}
        onBalloonsChange={onBalloonsChange}
      />
    </section>
  );
}

function DrawingSession({
  seedBalloons,
  balloons,
  allBalloons,
  selectedId,
  machiningId,
  onSelect,
  drawing,
  page,
  onPageChange,
  onBalloonsChange,
}: {
  seedBalloons: DrawingBalloon[];
  balloons: DrawingBalloon[];
  allBalloons: DrawingBalloon[];
  selectedId: string | null;
  machiningId: string | null;
  onSelect: (id: string) => void;
  drawing: ActiveDrawing | null;
  page: number;
  onPageChange: (page: number) => void;
  onBalloonsChange: (allPages: DrawingBalloon[] | null) => void;
}) {
  const src = drawing ? drawingFileUrl(drawing.relPath) : null;
  const localLayout = drawing ? readBalloonLayoutLocal(drawing.relPath) : null;

  const [phase, setPhase] = useState<Phase>(drawing ? "converting" : "idle");
  const [pages, setPages] = useState<DrawingPageImage[]>([]);
  const [editMode, setEditMode] = useState<BalloonEditMode>(() =>
    localLayout?.mode ??
      (drawing ? readBalloonEditMode(drawing.relPath) : "lock"),
  );
  const [addCount, setAddCount] = useState(1);
  const allRef = useRef<DrawingBalloon[]>(localLayout?.balloons ?? []);
  const editModeRef = useRef(editMode);
  const loadToken = useRef(0);
  const drawingRelPath = drawing?.relPath;

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const activePage = pages.find((p) => p.page === page);
  const activeImage =
    activePage?.dataUrl ??
    (drawing?.kind === "image" && src ? src : null);

  const designMode = editMode === "design";

  const countsByPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of allBalloons ?? []) {
      const p = b.page ?? 1;
      map.set(p, (map.get(p) ?? 0) + 1);
    }
    return map;
  }, [allBalloons]);

  useEffect(() => {
    let cancelled = false;
    const token = ++loadToken.current;

    async function run() {
      if (!drawing || !src) {
        setPhase("idle");
        onBalloonsChange(null);
        return;
      }

      // Restore saved balloons ASAP (local), then reconcile with server file.
      const local = readBalloonLayoutLocal(drawing.relPath);
      if (local) {
        allRef.current = local.balloons;
        setEditMode(local.mode);
        onBalloonsChange(local.balloons);
      }

      try {
        if (drawing.kind === "pdf") {
          setPhase("converting");
          const pageImages = await pdfToPageImages(
            src,
            undefined,
            (pageRaster) => {
              if (cancelled || token !== loadToken.current) return;
              setPages((prev) => {
                const next = prev.filter((p) => p.page !== pageRaster.page);
                next.push(pageRaster);
                next.sort((a, b) => a.page - b.page);
                return next;
              });
            },
          );
          if (cancelled || token !== loadToken.current) return;
          setPages(pageImages);
        } else {
          const dataUrl = src.startsWith("data:")
            ? src
            : await fetchAsDataUrl(src);
          if (cancelled || token !== loadToken.current) return;
          setPages([{ page: 1, dataUrl, width: 0, height: 0 }]);
        }

        if (cancelled || token !== loadToken.current) return;

        const saved = await loadBalloonLayout(drawing.relPath);
        if (cancelled || token !== loadToken.current) return;

        const initial = saved?.balloons ?? [];
        allRef.current = initial;
        if (saved?.mode) setEditMode(saved.mode);
        onBalloonsChange(initial);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
      loadToken.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush current balloons when the tab/app is closed.
  useEffect(() => {
    if (!drawingRelPath) return;
    function flush() {
      void persistBalloonLayout(
        drawingRelPath!,
        allRef.current,
        editModeRef.current,
      );
    }
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [drawingRelPath]);

  useEffect(() => {
    if (!designMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (!selectedId) return;
      e.preventDefault();
      deleteBalloon(selectedId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMode, selectedId]);

  function setMode(mode: BalloonEditMode) {
    setEditMode(mode);
    editModeRef.current = mode;
    if (drawing) {
      writeBalloonEditMode(drawing.relPath, mode);
      void persistBalloonLayout(drawing.relPath, allRef.current, mode);
    }
  }

  function rosterBase(): DrawingBalloon[] {
    if (allRef.current.length > 0) return allRef.current;
    if (allBalloons.length > 0) return allBalloons;
    return seedBalloons.map((b) => ({ ...b, page: b.page ?? 1 }));
  }

  function commitBalloons(next: DrawingBalloon[]) {
    allRef.current = next;
    onBalloonsChange(next);
    if (drawing) {
      void persistBalloonLayout(drawing.relPath, next, editModeRef.current);
    }
  }

  function moveBalloon(id: string, xPct: number, yPct: number) {
    if (!designMode) return;
    const next = rosterBase().map((b) =>
      b.id === id
        ? {
            ...b,
            xPct: clamp(xPct, 0, 100),
            yPct: clamp(yPct, 0, 100),
            source: "manual" as const,
          }
        : b,
    );
    if (!next.some((b) => b.id === id)) return;
    commitBalloons(next);
  }

  function addBalloonsAt(xPct: number, yPct: number) {
    if (!designMode || !drawing) return;
    const base = allRef.current.length > 0 ? allRef.current : [];
    const created = createManualBalloons(base, page, xPct, yPct, addCount);
    commitBalloons([...base, ...created]);
    const last = created[created.length - 1];
    if (last) onSelect(last.id);
  }

  function deleteBalloon(id: string) {
    if (!designMode) return;
    const base = allRef.current.length > 0 ? allRef.current : allBalloons;
    const next = base.filter((b) => b.id !== id);
    commitBalloons(next);
    if (selectedId === id) {
      const onPage = next.find((b) => (b.page ?? 1) === page) ?? next[0];
      if (onPage) onSelect(onPage.id);
    }
  }

  const busy = phase === "converting";

  return (
    <div className="relative min-h-0 flex-1">
      <DrawingStage
        imageSrc={activeImage}
        imageLabel="Drawing"
        worldWidth={activePage?.width || 1000}
        worldHeight={activePage?.height || 1000}
        balloons={balloons}
        selectedId={selectedId}
        machiningId={machiningId}
        adjustMode={designMode}
        busyLabel={busy && !activeImage ? " " : null}
        onSelect={onSelect}
        onMove={moveBalloon}
        onAdd={designMode ? addBalloonsAt : undefined}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 bg-gradient-to-b from-[#0a1219]/90 via-[#0a1219]/55 to-transparent px-2 pb-5 pt-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {pages.map((p) => {
            const n = countsByPage.get(p.page) ?? 0;
            const active = p.page === page;
            return (
              <button
                key={p.page}
                type="button"
                onClick={() => onPageChange(p.page)}
                className={cn(
                  "pointer-events-auto rounded px-2 py-0.5 text-[11px] tabular-nums backdrop-blur-sm",
                  active
                    ? "bg-[#1a2836]/95 text-[#7eb6e8]"
                    : "bg-[#0b111b]/70 text-[#6b7c8f] hover:text-foreground",
                )}
              >
                Page {p.page}
                <span className="ml-1 opacity-70">({n})</span>
              </button>
            );
          })}
        </div>

        {drawing ? (
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            <div className="flex rounded border border-[#243141] bg-[#0b111b]/85 p-0.5 text-[10px] uppercase tracking-[0.06em]">
              <button
                type="button"
                onClick={() => setMode("design")}
                className={cn(
                  "rounded px-2 py-0.5",
                  designMode
                    ? "bg-[#1a2836] text-[#7eb6e8]"
                    : "text-[#6b7c8f] hover:text-foreground",
                )}
              >
                Design
              </button>
              <button
                type="button"
                onClick={() => setMode("lock")}
                className={cn(
                  "rounded px-2 py-0.5",
                  !designMode
                    ? "bg-[#1a2836] text-[#7eb6e8]"
                    : "text-[#6b7c8f] hover:text-foreground",
                )}
              >
                Locked
              </button>
            </div>

            {designMode ? (
              <>
                <label className="flex items-center gap-1 rounded border border-[#243141] bg-[#0b111b]/85 px-1.5 py-0.5 text-[10px] text-[#8fa3b5]">
                  Add
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={addCount}
                    onChange={(e) =>
                      setAddCount(
                        clamp(Number(e.target.value) || 1, 1, 24),
                      )
                    }
                    className="w-8 bg-transparent text-center tabular-nums text-[#e8eef4] outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={!selectedId}
                  onClick={() => selectedId && deleteBalloon(selectedId)}
                  className="rounded border border-[#243141] bg-[#0b111b]/85 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[#8fa3b5] hover:border-[#f43f5e]/40 hover:text-[#f43f5e] disabled:opacity-40"
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}
