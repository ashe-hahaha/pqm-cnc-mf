"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

/** Drag the title bar while keeping the entire popup inside the viewport. */
export function usePopupDrag(id?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; offset: typeof offset; rect: DOMRect } | null>(null);
  useEffect(() => { setOffset({ x: 0, y: 0 }); drag.current = null; }, [id]);
  useEffect(() => {
    const clamp = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = rect.left < 8 ? 8 - rect.left : rect.right > window.innerWidth - 8 ? window.innerWidth - 8 - rect.right : 0;
      const dy = rect.top < 8 ? 8 - rect.top : rect.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - rect.bottom : 0;
      if (dx || dy) setOffset(p => ({ x: p.x + dx, y: p.y + dy }));
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  const titleProps = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, offset, rect };
      event.preventDefault();
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.pointer) return;
      setOffset({
        x: d.offset.x + Math.max(8 - d.rect.left, Math.min(window.innerWidth - 8 - d.rect.right, event.clientX - d.x)),
        y: d.offset.y + Math.max(8 - d.rect.top, Math.min(window.innerHeight - 8 - d.rect.bottom, event.clientY - d.y)),
      });
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  };
  return { ref, style: { transform: `translate(${offset.x}px, ${offset.y}px)` }, titleProps };
}
