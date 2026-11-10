"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/format";

/**
 * Shared 1s tick (same pattern as oee-platform LiveClock).
 * Snapshot must be pure and referentially stable between ticks.
 */
let currentTick = typeof window !== "undefined" ? Date.now() : 0;
const listeners = new Set<() => void>();
let intervalId: number | null = null;

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  if (intervalId === null && typeof window !== "undefined") {
    if (currentTick === 0) currentTick = Date.now();
    intervalId = window.setInterval(() => {
      currentTick = Date.now();
      for (const listener of listeners) listener();
    }, 1000);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot() {
  return currentTick;
}

function getServerSnapshot() {
  return 0;
}

export function LiveClock({
  className,
  showDate = true,
}: {
  className?: string;
  showDate?: boolean;
}) {
  const nowMs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!nowMs) {
    return (
      <span className={cn("tabular-nums text-[#5a6b7a]", className)}>—</span>
    );
  }

  const now = new Date(nowMs);
  const date = now.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <time
      dateTime={now.toISOString()}
      className={cn("tabular-nums", className)}
      title="Local time"
    >
      {showDate ? (
        <>
          <span className="text-[#8fa3b5]">{date}</span>
          <span className="mx-1.5 text-[#5a6b7a]">·</span>
          <span className="text-foreground">{time}</span>
        </>
      ) : (
        <span className="text-foreground">{time}</span>
      )}
    </time>
  );
}
