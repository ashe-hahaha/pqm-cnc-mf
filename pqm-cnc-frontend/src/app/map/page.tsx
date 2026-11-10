import { predictedScrapPct } from "@/domain/quality";
import { cpkLabel, pct } from "@/lib/format";
import { compositeHealth } from "@/lib/qualityHealth";
import { assets, plantName } from "@/seed/plant";
import { listDrivers } from "@/sim/store";

const healthClass = {
  green: "border-good/50 bg-good/10 text-good",
  gold: "border-warn/50 bg-warn/10 text-warn",
  bad: "border-bad/50 bg-bad/10 text-bad",
  red: "border-bad/50 bg-bad/10 text-bad",
} as const;

export default function MapPage() {
  const machines = assets.filter((a) => a.level === "machine");
  const cells = assets.filter((a) => a.level === "cell");
  const drivers = listDrivers();

  const machineCards = machines.map((m) => {
    const d = drivers.find((x) => x.machineId === m.id);
    const risk = d
      ? predictedScrapPct(d)
      : 1.2;
    const cpk = d?.lastCpk ?? 1.4;
    const deviation = d ? Math.max(d.toolWearRatio, d.thermalDriftRatio) * 0.9 : 0.3;
    const health = compositeHealth({
      predictedScrapPct: risk,
      avgCpk: cpk,
      maxDeviationRatio: deviation,
    });
    return { machine: m, risk, cpk, health };
  });

  const plantRisk =
    machineCards.reduce((s, m) => s + m.risk, 0) / Math.max(machineCards.length, 1);
  const plantCpk =
    machineCards.reduce((s, m) => s + m.cpk, 0) / Math.max(machineCards.length, 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">{plantName}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Shop-floor landing (S0 shell). Traffic cards use seed/sim drivers —
            full SVG cell map lands in M6.
          </p>
        </div>
        <div className="flex gap-3">
          <Kpi label="Predicted scrap" value={pct(plantRisk)} delay={0} />
          <Kpi label="Avg Cpk" value={cpkLabel(plantCpk)} delay={1} />
          <Kpi label="Cells" value={String(cells.length)} delay={2} />
        </div>
      </div>

      <div className="mesh-grid relative min-h-[420px] overflow-hidden rounded-lg border border-panel-border bg-panel/60 p-6">
        <p className="mb-4 text-[11px] uppercase tracking-[0.16em] text-muted">
          Cell quality risk · seed preview
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {machineCards.map((card, i) => (
            <div
              key={card.machine.id}
              className={`kpi-enter rounded-md border px-4 py-3 ${healthClass[card.health]}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <p className="text-[11px] uppercase tracking-[0.14em] opacity-80">
                {card.machine.code}
              </p>
              <p className="font-display text-xl">{card.machine.name}</p>
              <div className="mt-2 flex gap-4 text-sm">
                <span>Risk {pct(card.risk)}</span>
                <span>Cpk {cpkLabel(card.cpk)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        Workplan: see <code className="text-accent">README.md</code> and{" "}
        <code className="text-accent">docs/WORKPLAN.md</code>. Next: M1 soft
        login, M6 full map camera.
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  delay,
}: {
  label: string;
  value: string;
  delay: number;
}) {
  return (
    <div
      className="kpi-enter min-w-[7.5rem] rounded-md border border-panel-border bg-panel px-3 py-2"
      style={{ animationDelay: `${delay * 80}ms` }}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="font-display text-2xl text-foreground">{value}</p>
    </div>
  );
}
