"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CopilotDrawer } from "@/components/CopilotDrawer";
import { CopilotContextProvider } from "@/components/copilot/CopilotContext";
import { plantName, productName } from "@/seed/plant";

const nav = [
  { href: "/map", label: "Map" },
  { href: "/dashboard", label: "Monitor" },
  { href: "/quality", label: "Quality" },
  { href: "/hmi", label: "HMI" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/demo", label: "Demo" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOpsDashboard = pathname === "/dashboard";

  // Page 1 operational template owns its chrome (sidebar + header).
  if (isOpsDashboard) {
    return (
      <CopilotContextProvider>
        <div className="min-h-full bg-[#0b1724]">{children}</div>
        <CopilotDrawer />
      </CopilotContextProvider>
    );
  }

  return (
    <CopilotContextProvider>
      <div className="shop-bg flex min-h-full flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-panel-border/80 bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-4 py-3">
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight tracking-tight text-foreground">
                {productName}
              </p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
                {plantName} · Phase D
              </p>
            </div>
            <nav className="ml-auto flex flex-wrap items-center gap-1 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1.5 text-muted transition-colors hover:bg-panel hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-4 md:py-5">
          {children}
        </main>
      </div>
      <CopilotDrawer />
    </CopilotContextProvider>
  );
}
