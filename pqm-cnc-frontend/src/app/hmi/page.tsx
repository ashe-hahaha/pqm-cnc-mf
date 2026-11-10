import Link from "next/link";
import type { InProcessLabel } from "@/domain/types";
import { cn } from "@/lib/format";
import { queryAllLiveInference } from "@/lib/queries/inference";
import { assets } from "@/seed/plant";

const labelClass: Record<InProcessLabel, string> = {
  ok: "border-good/50 bg-good/10 text-good",
  watch: "border-warn/50 bg-warn/10 text-warn",
  suspect: "border-bad/40 bg-bad/10 text-bad",
  critical: "border-bad/60 bg-bad/15 text-bad",
};

export default function HmiIndexPage() {
  const predictions = queryAllLiveInference().sort(
    (a, b) => a.qualityScore - b.qualityScore,
  );
  const byId = new Map(assets.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-accent">
          Machine-level AI
        </p>
        <h1 className="font-display text-3xl tracking-tight">
          Operator alert HMI
        </h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          In-process quality score per machine. Open a machine for live Q,
          drivers, and process context.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {predictions.map((p, i) => {
          const machine = byId.get(p.machineId);
          if (!machine) return null;
          return (
            <Link
              key={p.machineId}
              href={`/hmi/${p.machineId}`}
              className={cn(
                "kpi-enter block rounded-md border px-4 py-3 transition-colors hover:bg-panel",
                labelClass[p.label],
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <p className="text-[11px] uppercase tracking-[0.14em] opacity-80">
                {machine.code}
              </p>
              <p className="font-display text-xl">{machine.name}</p>
              <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-display text-3xl tabular-nums">
                  {p.qualityScore.toFixed(0)}
                </span>
                <span className="uppercase tracking-[0.12em]">{p.label}</span>
              </div>
              {p.topDrivers[0] ? (
                <p className="mt-2 text-xs opacity-80">
                  ↑ {p.topDrivers[0].name}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
