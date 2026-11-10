"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/format";

/**
 * Fixed-height box with a bottom drag handle to resize the display area.
 */
export function ResizableBox({
  id,
  height,
  minHeight = 120,
  maxHeight = 1200,
  locked = false,
  onHeightChange,
  className,
  children,
}: {
  /** DOM id, so `/dashboard#<id>` deep-links scroll to this box. */
  id?: string;
  height: number;
  minHeight?: number;
  maxHeight?: number;
  locked?: boolean;
  onHeightChange: (height: number) => void;
  className?: string;
  children: ReactNode;
}) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const renderedHeight = Number.isFinite(height) && height > 0
    ? Math.max(minHeight, Math.min(maxHeight, height))
    : Math.max(minHeight, 280);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (locked || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const measuredHeight = boxRef.current?.getBoundingClientRect().height;
      start.current = { y: e.clientY, h: measuredHeight || renderedHeight };
      setDragging(true);
    },
    [renderedHeight, locked],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (locked || !start.current) return;
      const next = Math.min(
        maxHeight,
        Math.max(minHeight, start.current.h + (e.clientY - start.current.y)),
      );
      onHeightChange(next);
    },
    [locked, maxHeight, minHeight, onHeightChange],
  );

  const onPointerUp = useCallback(() => {
    start.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    const prev = document.body.style.cursor;
    const select = document.body.style.userSelect;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.style.cursor = prev;
      document.body.style.userSelect = select;
    };
  }, [dragging, onPointerMove, onPointerUp]);

  return (
    <div
      id={id}
      ref={boxRef}
      className={cn("relative flex shrink-0 flex-col scroll-mt-3", className)}
      style={{ height: renderedHeight, minHeight: renderedHeight, flexShrink: 0 }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {!locked ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          aria-controls={id}
          aria-valuemin={minHeight}
          aria-valuemax={maxHeight}
          aria-valuenow={renderedHeight}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onHeightChange(Math.max(minHeight, Math.min(maxHeight, renderedHeight + (event.key === "ArrowDown" ? 20 : -20))));
          }}
          onPointerDown={onPointerDown}
          style={{ touchAction: "none" }}
          className={cn(
            "group absolute inset-x-0 bottom-0 z-10 flex h-3 cursor-ns-resize items-end justify-center",
            dragging && "bg-[#3d8fd1]/10",
          )}
        >
          <span
            className={cn(
              "mb-0.5 h-1 w-10 rounded-full bg-[#3a4a5a] transition-colors group-hover:bg-[#7eb6e8]",
              dragging && "bg-[#7eb6e8]",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Vertical drag handle between dashboard columns. */
export function ColResizeHandle({
  locked = false,
  onDrag,
}: {
  locked?: boolean;
  onDrag: (deltaX: number) => void;
}) {
  const startX = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  if (locked) {
    return <div className="hidden w-3 shrink-0 xl:block" aria-hidden />;
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize columns"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startX.current = e.clientX;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (startX.current == null) return;
        const dx = e.clientX - startX.current;
        startX.current = e.clientX;
        onDrag(dx);
      }}
      onPointerUp={() => {
        startX.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        startX.current = null;
        setDragging(false);
      }}
      className={cn(
        "relative z-10 w-2 shrink-0 cursor-col-resize self-stretch",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-[#243141]",
        "hover:after:bg-[#7eb6e8]",
        dragging && "after:bg-[#7eb6e8]",
      )}
    />
  );
}
