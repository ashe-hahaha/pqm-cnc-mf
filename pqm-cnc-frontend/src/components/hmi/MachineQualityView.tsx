import type { InProcessLabel, InProcessPrediction } from "@/domain/types";
import { HfScopes } from "@/components/charts/HfScopes";
import { cn } from "@/lib/format";
import { ampFromMachineSignals } from "@/lib/hfSensors";

const labelClass: Record<InProcessLabel, string> = {
  ok: "border-good/50 bg-good/10 text-good",
  watch: "border-warn/50 bg-warn/10 text-warn",
  suspect: "border-bad/40 bg-bad/10 text-bad",
  critical: "border-bad/60 bg-bad/15 text-bad",
};

export function MachineQualityView({
  machineCode,
  machineName,
  prediction,
}: {
  machineCode: string;
  machineName: string;
  prediction: InProcessPrediction;
}) {
  const { context, signals, topDrivers } = prediction;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
            Operator HMI · in-process quality
          </p>
          <h1 className="font-display text-3xl tracking-tight">
            {machineCode}
            <span className="ml-3 text-xl text-muted">{machineName}</span>
          </h1>
          {prediction.currentOpLabel ? (
            <p className="mt-1 text-sm text-muted">
              Current op:{" "}
              <span className="text-foreground">{prediction.currentOpLabel}</span>
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          Model {prediction.modelVersion} ·{" "}
          {new Date(prediction.ts).toLocaleTimeString()}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div
          className={cn(
            "kpi-enter flex flex-col items-center justify-center rounded-lg border px-6 py-8",
            labelClass[prediction.label],
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.16em] opacity-80">
            Live quality score
          </p>
          <p className="font-display text-6xl tabular-nums tracking-tight">
            {prediction.qualityScore.toFixed(0)}
          </p>
          <p className="mt-2 text-sm uppercase tracking-[0.14em]">
            {prediction.label}
          </p>
          <div className="mt-4 flex gap-4 text-xs opacity-90">
            <span>P(defect) {(prediction.defectProb * 100).toFixed(0)}%</span>
            <span>Conf {(prediction.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-panel-border bg-panel/60 p-4">
            <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted">
              Top drivers
            </h2>
            {topDrivers.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No elevated drivers</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {topDrivers.map((d) => (
                  <li
                    key={d.name}
                    className="rounded border border-panel-border bg-background/40 px-3 py-1.5 text-sm"
                  >
                    <span className="text-accent">
                      {d.direction === "up" ? "↑" : "↓"}
                    </span>{" "}
                    {d.name}
                    <span className="ml-2 text-muted">
                      {(d.weight * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-panel-border bg-panel/60 p-4">
            <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted">
              Process context
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <ContextItem label="Feed" value={`${context.feedMmMin} mm/min`} />
              <ContextItem label="Spindle" value={`${context.spindleRpm} rpm`} />
              <ContextItem label="Tool" value={`${context.toolCode} · ${context.toolGeometry}`} />
              <ContextItem label="ae / ap" value={`${context.widthOfCutMm} / ${context.depthOfCutMm} mm`} />
              <ContextItem label="Material" value={context.material} />
              <ContextItem label="Axis load" value={`${context.axisLoadPct}%`} />
            </dl>
          </section>

          <section className="rounded-lg border border-panel-border bg-panel/60 p-4">
            <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted">
              Signal summary
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <ContextItem
                label="Vibration RMS"
                value={`${signals.vibrationRms} (${signals.vibrationBandHz})`}
              />
              <ContextItem
                label="Acoustic RMS"
                value={`${signals.acousticRms} (${signals.acousticBandKHz})`}
              />
            </dl>
            <div className="mt-4">
              <HfScopes
                seed={machineCode.length * 5.3}
                amp={ampFromMachineSignals(signals)}
                columns={2}
              />
            </div>
          </section>
        </div>
      </div>

      <p className="text-xs text-muted">
        Phase D: score from sim heuristic. Phase P replaces{" "}
        <code className="text-accent">/api/inference/live</code> with the edge
        model — same machine-level contract.
      </p>
    </div>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
