"use client";

import { useEffect, useRef, useState } from "react";
import type {
  DrawingBalloon,
  OpsRecommendation,
} from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";
import { recPill, recTone } from "./opsStyles";

const priorityLabel = {
  high: "High",
  recommended: "Rec",
  info: "Info",
  ok: "OK",
} as const;

export function OpsRecommendations({
  items,
  selected,
  onFocusBalloon,
}: {
  items: OpsRecommendation[];
  selected: DrawingBalloon | null;
  onFocusBalloon: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((r) => r.id === openId) ?? null;

  return (
    <Panel
      title="AI recommendations"
      className="h-full"
      bodyClassName="gap-0 p-2"
    >
      {items.length === 0 ? (
        <p className="px-1 text-xs text-[#8fa3b5]">No recommendations.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((r) => {
            const active = r.balloonId != null && r.balloonId === selected?.id;
            const expanded = openId === r.id;
            return (
              <li key={r.id} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : r.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors",
                    recTone[r.priority],
                    (active || expanded) && "ring-1 ring-[#3d8fd1]",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                      recPill[r.priority],
                    )}
                  >
                    {priorityLabel[r.priority]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#6b7c8f]">
                    {expanded ? "▾" : "›"}
                  </span>
                </button>

                {expanded && open ? (
                  <RecDetailPopover
                    item={open}
                    onClose={() => setOpenId(null)}
                    onFocusBalloon={onFocusBalloon}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function RecDetailPopover({
  item,
  onClose,
  onFocusBalloon,
}: {
  item: OpsRecommendation;
  onClose: () => void;
  onFocusBalloon: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={item.title}
      className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-[#2a3a4a] bg-[#0b111b] p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{item.title}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-[11px] text-[#6b7c8f] hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[#9eb0c0]">
        {item.detail}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
            recPill[item.priority],
          )}
        >
          {priorityLabel[item.priority]}
        </span>
        {item.balloonId ? (
          <button
            type="button"
            onClick={() => {
              onFocusBalloon(item.balloonId!);
              onClose();
            }}
            className="rounded border border-[#3d8fd1]/40 bg-[#3d8fd1]/10 px-2 py-0.5 text-[10px] text-[#7eb6e8] hover:bg-[#3d8fd1]/20"
          >
            Focus balloon
          </button>
        ) : null}
      </div>
    </div>
  );
}
