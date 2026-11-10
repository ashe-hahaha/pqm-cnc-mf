"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

const STORAGE_KEY = "pqm.ops.sidebar";

type SidebarView = "open" | "collapsed" | "hidden";

const items: {
  id: string;
  label: string;
  href: string;
  icon: string;
  badge?: number;
}[] = [
  { id: "overview", label: "Overview", href: "/dashboard", icon: "▣" },
  { id: "drawing", label: "Drawing", href: "/dashboard#drawing", icon: "◫" },
  { id: "trends", label: "Trends", href: "/dashboard#trend", icon: "∿" },
  { id: "process", label: "Process", href: "/dashboard#process", icon: "⚙" },
  { id: "reports", label: "Reports", href: "/quality", icon: "☰" },
  { id: "alerts", label: "Alerts", href: "/dashboard#alerts", icon: "🔔", badge: 3 },
  { id: "settings", label: "Settings", href: "/demo", icon: "◎" },
];

function readView(): SidebarView {
  if (typeof window === "undefined") return "open";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "open" || raw === "collapsed" || raw === "hidden") return raw;
  } catch {
    /* ignore */
  }
  return "open";
}

export function OpsSidebar({ onMonitorChange }: { onMonitorChange?: (view: "quality" | "tool-wear") => void }) {
  const pathname = usePathname();
  const [view, setView] = useState<SidebarView>("open");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setView(readView());
    setReady(true);
  }, []);

  function setSidebarView(next: SidebarView) {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  if (!ready) {
    return <aside className="w-[188px] shrink-0 border-r border-[#243141] bg-[#0a1018]" />;
  }

  if (view === "hidden") {
    return (
      <button
        type="button"
        onClick={() => setSidebarView("open")}
        title="Show sidebar"
        aria-label="Show sidebar"
        aria-expanded={false}
        className="fixed left-0 top-1/2 z-50 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-[#243141] bg-[#0a1018] text-[11px] text-[#8fa3b5] shadow-[2px_0_12px_rgba(0,0,0,0.35)] hover:bg-[#121a24] hover:text-[#7eb6e8]"
      >
        <span aria-hidden="true">›</span>
      </button>
    );
  }

  const collapsed = view === "collapsed";

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-[#243141] bg-[#0a1018] py-3 transition-[width]",
        collapsed ? "w-[64px]" : "w-[188px]",
      )}
    >
      <button
        type="button"
        onClick={() => setSidebarView("hidden")}
        title="Hide sidebar"
        aria-label="Hide sidebar"
        aria-expanded={true}
        className={cn(
          "fixed top-1/2 z-50 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-[#243141] bg-[#0a1018] text-lg text-[#8fa3b5] shadow-[2px_0_12px_rgba(0,0,0,0.35)] transition-[left] hover:bg-[#121a24] hover:text-[#7eb6e8] focus-visible:outline-2 focus-visible:outline-[#7eb6e8]",
          collapsed ? "left-[64px]" : "left-[188px]",
        )}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <div className="flex items-center justify-center border-b border-[#243141] px-3 pb-3 pt-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={collapsed ? "/pqm-mark.svg" : "/pqm-logo.svg"}
          alt="PQM"
          className={cn(
            "select-none object-contain object-left",
            collapsed ? "h-8 w-8" : "h-9 w-[148px]",
          )}
          draggable={false}
        />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-3">
        <button type="button" onClick={() => onMonitorChange?.("tool-wear")} title="Tool wear" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-[#8fa3b5] hover:bg-[#121a24] hover:text-foreground">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#121a24] text-sm">◈</span>
          {!collapsed && <span>Tool Wear</span>}
        </button>
        {items.map((item) => {
          const pathOnly = item.href.split("#")[0] ?? item.href;
          const selected =
            item.id === "overview"
              ? pathname === "/dashboard"
              : pathOnly !== "/dashboard" && pathname === pathOnly;

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => { if (pathOnly === "/dashboard") onMonitorChange?.("quality"); }}
              title={item.label}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-xs transition-colors",
                selected
                  ? "border-[#2a3a4a] bg-[#1a2836] text-foreground"
                  : "text-[#8fa3b5] hover:bg-[#121a24] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm",
                  selected ? "bg-[#3d8fd1]/20 text-[#7eb6e8]" : "bg-[#121a24]",
                )}
              >
                {item.icon}
              </span>
              {!collapsed ? (
                <span className="truncate">{item.label}</span>
              ) : null}
              {item.badge != null && !collapsed ? (
                <span className="ml-auto rounded-full bg-bad px-1.5 text-[10px] font-bold text-[#0b111b]">
                  {item.badge}
                </span>
              ) : null}
              {item.badge != null && collapsed ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-bad" />
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-[#243141] px-2 pt-3">
        <button
          type="button"
          onClick={() =>
            setSidebarView(collapsed ? "open" : "collapsed")
          }
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] uppercase tracking-[0.12em] text-[#6b7c8f] hover:bg-[#121a24] hover:text-[#9eb0c0]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#121a24]">
            {collapsed ? "»" : "«"}
          </span>
          {!collapsed ? "Collapse" : null}
        </button>
      </div>
    </aside>
  );
}
