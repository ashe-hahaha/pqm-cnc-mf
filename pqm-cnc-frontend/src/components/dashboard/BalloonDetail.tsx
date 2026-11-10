import type {
  BalloonPrediction,
  DrawingBalloon,
} from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";
import { riskLabel, riskText } from "./opsStyles";

export function BalloonDetail({
  balloon,
  prediction,
}: {
  balloon: DrawingBalloon | null;
  prediction: BalloonPrediction | null;
}) {
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
          <Header balloon={balloon} />
          <p className="text-[11px] leading-snug text-[#8fa3b5]">
            Not machined yet — prediction appears when this balloon finishes.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          <Header balloon={balloon} />
          <Row
            label="Predicted"
            value={`${prediction.predictedValue.toFixed(3)} ${balloon.unit}`}
            emphasis
          />
          <Row label="Spec" value={formatSpec(balloon)} />
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

function Header({ balloon }: { balloon: DrawingBalloon }) {
  return (
    <div className="mb-1.5 rounded border border-[#2a3a4a] bg-[#0e1620] px-2 py-1">
      <p className="font-display text-lg leading-tight text-foreground">
        {balloon.code}
        <span className="ml-1.5 text-[11px] font-sans font-normal text-[#8fa3b5]">
          {balloon.characteristic}
          <span className="text-[#5a6b7a]"> · </span>
          {balloon.featureKind}
        </span>
      </p>
    </div>
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
