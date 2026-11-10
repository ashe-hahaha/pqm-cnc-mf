import { balloonSummary, type DrawingBalloon } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";

export function BalloonSummary({
  balloons,
  overallQuality,
  predictionConfidence,
}: {
  balloons: DrawingBalloon[];
  overallQuality: "good" | "watch" | "poor";
  predictionConfidence: number;
}) {
  const s = balloonSummary(balloons);
  const cells = [
    { label: "PASS", value: s.pass, tone: "text-good", ring: "border-good/30" },
    { label: "WARNING", value: s.warning, tone: "text-warn", ring: "border-warn/30" },
    { label: "HIGH RISK", value: s.highRisk, tone: "text-bad", ring: "border-bad/30" },
    {
      label: "NOT MACHINED",
      value: s.notMachined,
      tone: "text-[#8fa3b5]",
      ring: "border-[#5a6b7a]/40",
    },
  ];

  return (
    <Panel title="Balloon quality summary">
      <div className="grid grid-cols-2 gap-2">
        {cells.map((c) => (
          <div
            key={c.label}
            className={cn(
              "rounded-lg border bg-[#0e1620] px-2.5 py-2.5",
              c.ring,
            )}
          >
            <p
              className={cn(
                "font-display text-3xl leading-none tabular-nums",
                c.tone,
              )}
            >
              {c.value}
            </p>
            <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#6b7c8f]">
              {c.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-3 border-t border-[#243141] pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#8fa3b5]">Overall Quality Status</span>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
              overallQuality === "good" && "bg-good/15 text-good",
              overallQuality === "watch" && "bg-warn/15 text-warn",
              overallQuality === "poor" && "bg-bad/15 text-bad",
            )}
          >
            {overallQuality}
          </span>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-[#8fa3b5]">Prediction Confidence</span>
            <span className="font-semibold tabular-nums text-good">
              {Math.round(predictionConfidence * 100)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#0e1620]">
            <div
              className="h-full rounded-full bg-good"
              style={{ width: `${predictionConfidence * 100}%` }}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
