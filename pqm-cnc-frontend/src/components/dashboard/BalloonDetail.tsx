import { useState } from "react";
import type {
  BalloonPrediction,
  DrawingBalloon,
} from "@/domain/opsDashboard";
import { validateTolerance, type Tolerance } from "@/lib/balloonTolerance";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";
import { riskLabel, riskText } from "./opsStyles";

export function BalloonDetail({
  balloon,
  prediction,
  onToleranceChange,
  emptyHint = "Not machined yet — prediction appears when this balloon finishes.",
}: {
  balloon: DrawingBalloon | null;
  prediction: BalloonPrediction | null;
  /** When given, the Spec row can be edited. */
  onToleranceChange?: (balloonId: string, tolerance: Tolerance) => void;
  emptyHint?: string;
}) {
  // Which balloon's tolerance is being edited (the edit button sits in the header row).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = balloon != null && editingId === balloon.id;
  const specRow = balloon ? (
    <SpecRow
      key={`${balloon.id}:${balloon.nominal}:${balloon.upperTol}:${balloon.lowerTol}`}
      balloon={balloon}
      editing={editing}
      onClose={() => setEditingId(null)}
      onSave={onToleranceChange ? (tolerance) => onToleranceChange(balloon.id, tolerance) : undefined}
    />
  ) : null;
  const headerProps = {
    editable: Boolean(onToleranceChange),
    editing,
    onEdit: () => balloon && setEditingId(balloon.id),
  };
  const badge = balloon ? (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        balloon.risk === "high_risk" && "bg-bad text-[#0b1724]",
        balloon.risk === "warning" && "bg-warn text-[#0b1724]",
        balloon.risk === "pass" && "bg-good text-[#0b1724]",
        balloon.risk === "not_machined" && "bg-[#5a6b7a] text-[#0b1724]",
      )}
    >
      {riskLabel[balloon.risk]}
    </span>
  ) : null;

  return (
    <Panel
      title="Selected Balloon Detail"
      titleRight={badge}
      className="h-full"
      bodyClassName="gap-0 p-2.5"
    >
      {!balloon ? (
        <p className="text-xs text-[#8fa3b5]">Select a balloon on the drawing.</p>
      ) : !prediction ? (
        <div className="flex flex-col gap-1.5">
          <Header balloon={balloon} {...headerProps} />
          {specRow}
          <p className="text-[11px] leading-snug text-[#8fa3b5]">{emptyHint}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <Header balloon={balloon} {...headerProps} />
          <Row
            label="Predicted"
            value={`${prediction.predictedValue.toFixed(3)} ${balloon.unit}`}
            emphasis
          />
          {specRow}
          <Row
            label="Margin"
            value={`${prediction.margin >= 0 ? "+" : ""}${prediction.margin.toFixed(3)} ${prediction.marginUnit}`}
            className={
              balloon.risk === "high_risk" || balloon.risk === "warning"
                ? riskText[balloon.risk]
                : undefined
            }
          />
          <Row
            label="Pass prob."
            value={`${Math.round(prediction.passProbability * 100)}%`}
            className={
              prediction.passProbability < 0.5 ? "text-bad" : "text-good"
            }
            emphasis
          />
          <Row
            label="Confidence"
            value={`${Math.round(prediction.confidence * 100)}%`}
            className="text-good"
          />
          <Row
            label="Last QC"
            value={
              prediction.lastQcValue == null
                ? "N/A"
                : `${prediction.lastQcValue.toFixed(3)} ${balloon.unit}`
            }
          />
        </div>
      )}
    </Panel>
  );
}

function Header({
  balloon,
  editable,
  editing,
  onEdit,
}: {
  balloon: DrawingBalloon;
  editable: boolean;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2 rounded border border-[#2a3a4a] bg-[#0e1620] px-2 py-1">
      <p className="min-w-0 font-display text-lg leading-tight text-foreground">
        {balloon.code}
        <span className="ml-1.5 text-[11px] font-sans font-normal text-[#8fa3b5]">
          {balloon.characteristic}
          <span className="text-[#5a6b7a]"> · </span>
          {balloon.featureKind}
        </span>
      </p>
      {editable && (
        <button
          type="button"
          aria-label="Edit tolerance"
          title="Edit tolerance"
          aria-pressed={editing}
          onClick={onEdit}
          className={cn(
            "shrink-0 rounded border px-1.5 py-0.5 text-[11px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-sky-400",
            editing
              ? "border-[#3d8fd1]/50 bg-[#3d8fd1]/15 text-[#7eb6e8]"
              : "border-[#2a3a4a] text-[#8296a8] hover:bg-[#192a39] hover:text-[#c1d6e6]",
          )}
        >
          ✎
        </button>
      )}
    </div>
  );
}

const inputStyle =
  "w-full rounded border border-[#314254] bg-[#0c1722] px-1.5 py-1 text-xs tabular-nums text-[#c6d7e4] focus-visible:outline focus-visible:outline-1 focus-visible:outline-sky-400";

/** Spec row with an inline editor for nominal, +upper and −lower tolerance. */
function SpecRow({
  balloon,
  editing,
  onClose,
  onSave,
}: {
  balloon: DrawingBalloon;
  editing: boolean;
  onClose: () => void;
  onSave?: (tolerance: Tolerance) => void;
}) {
  const [draft, setDraft] = useState({
    nominal: String(balloon.nominal),
    upperTol: String(balloon.upperTol),
    lowerTol: String(balloon.lowerTol),
  });
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-baseline justify-between gap-2 border-b border-[#2a3a4a]/60 py-1">
        <dt className="text-[9px] uppercase tracking-[0.08em] text-[#8fa3b5]">Spec</dt>
        <dd className="flex items-baseline gap-1.5 text-right text-xs tabular-nums leading-none text-foreground">
          {formatSpec(balloon)}
        </dd>
      </div>
    );
  }

  function save() {
    const next = {
      nominal: Number(draft.nominal),
      upperTol: Number(draft.upperTol),
      lowerTol: Number(draft.lowerTol),
    };
    const problem = draft.nominal.trim() === "" || draft.upperTol.trim() === "" || draft.lowerTol.trim() === ""
      ? "Fill in all three values."
      : validateTolerance(next);
    if (problem) {
      setError(problem);
      return;
    }
    onSave?.(next);
    onClose();
  }

  return (
    <form
      className="border-b border-[#2a3a4a]/60 py-1.5"
      onSubmit={(event) => { event.preventDefault(); save(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <div className="grid grid-cols-3 gap-1.5 text-[9px] uppercase tracking-[0.08em] text-[#8fa3b5]">
        {([
          ["nominal", "Nominal"],
          ["upperTol", "+ Upper"],
          ["lowerTol", "− Lower"],
        ] as const).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              autoFocus={key === "nominal"}
              className={inputStyle}
              type="number"
              step="any"
              min={key === "nominal" ? undefined : 0}
              value={draft[key]}
              onChange={(event) => { setDraft((d) => ({ ...d, [key]: event.target.value })); setError(null); }}
            />
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span role="alert" className="text-[10px] text-amber-400">{error}</span>
        <span className="flex gap-1.5">
          <button type="button" onClick={onClose} className="rounded border border-[#314254] px-2 py-0.5 text-[10px] text-[#8296a8] hover:text-[#c1d6e6]">Cancel</button>
          <button type="submit" className="rounded border border-[#385064] px-2 py-0.5 text-[10px] text-[#a5d8fa] hover:bg-[#192a39]">Save</button>
        </span>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  emphasis,
  className,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[#2a3a4a]/60 py-1 last:border-0">
      <dt className="text-[9px] uppercase tracking-[0.08em] text-[#8fa3b5]">
        {label}
      </dt>
      <dd
        className={cn(
          "text-right tabular-nums leading-none",
          emphasis ? "font-display text-base" : "text-xs",
          className ?? "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatSpec(b: DrawingBalloon) {
  if (b.lowerTol === 0 && b.nominal === 0) {
    return `≤ ${b.upperTol} ${b.unit}`;
  }
  if (b.lowerTol === b.upperTol) {
    return `${b.nominal.toFixed(3)} ±${b.upperTol} ${b.unit}`;
  }
  return `${b.nominal.toFixed(3)} +${b.upperTol}/-${b.lowerTol} ${b.unit}`;
}
