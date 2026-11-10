import type { ModelConfidence as ModelConfidenceData } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";

export function ModelConfidencePanel({
  data,
  balloonConfidence,
}: {
  data: ModelConfidenceData;
  balloonConfidence: number | null;
}) {
  const pred =
    balloonConfidence != null
      ? balloonConfidence
      : data.predictionConfidence;

  const gauges = [
    {
      label: "Prediction Confidence",
      pct: pred * 100,
      color: "#3d9b6e",
    },
    {
      label: "Similar Jobs Coverage",
      pct: data.similarJobsPct * 100,
      color: "#3d8fd1",
    },
    {
      label: "QC Coverage",
      pct: data.qcCoveragePct,
      color: data.qcCoveragePct < 15 ? "#c45c5c" : "#c4921a",
    },
  ];

  return (
    <Panel title="Model confidence & coverage">
      <div className="grid min-w-0 grid-cols-3 gap-3 [&>*]:min-w-0">
        {gauges.map((g) => (
          <Gauge key={g.label} {...g} />
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Inspected parts"
          value={`${data.inspectedParts} / ${data.batchTotal}`}
        />
        <Metric
          label="Model status"
          value={data.modelStatus}
          tone={data.modelStatus === "healthy" ? "text-good" : "text-warn"}
        />
      </div>

      <p className="mt-3 text-[10px] uppercase tracking-[0.1em] text-[#6b7c8f]">
        Last model update · {data.lastUpdate}
      </p>
    </Panel>
  );
}

function Gauge({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: string;
}) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const offset = c - (clamped / 100) * c;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative flex h-[72px] w-[72px] items-center justify-center">
        <svg
          width={72}
          height={72}
          viewBox="0 0 72 72"
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx={36}
            cy={36}
            r={r}
            fill="none"
            stroke="#0e1620"
            strokeWidth={7}
          />
          <circle
            cx={36}
            cy={36}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <p className="relative font-display text-lg tabular-nums text-foreground">
          {Math.round(clamped)}%
        </p>
      </div>
      <p className="mt-1.5 text-[10px] uppercase leading-tight tracking-[0.08em] text-[#6b7c8f]">
        {label}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-[#243141] bg-[#0e1620] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-[#6b7c8f]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold capitalize",
          tone ?? "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
