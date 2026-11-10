import type { OpsAlert } from "@/domain/opsDashboard";
import { cn } from "@/lib/format";
import { Panel } from "./Panel";
import { alertTone } from "./opsStyles";

export function OpsAlerts({
  alerts,
  onFocusBalloon,
}: {
  alerts: OpsAlert[];
  onFocusBalloon: (id: string) => void;
}) {
  return (
    <Panel id="alerts" title="Alerts" className="h-full">
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              disabled={!a.balloonId}
              onClick={() => a.balloonId && onFocusBalloon(a.balloonId)}
              className={cn(
                "flex w-full gap-2.5 rounded border border-[#2a3a4a] border-l-4 bg-[#0e1620] px-3 py-2.5 text-left",
                alertTone[a.severity],
                !a.balloonId && "cursor-default",
              )}
            >
              <AlertIcon severity={a.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wide",
                      a.severity === "high_risk" && "text-bad",
                      a.severity === "warning" && "text-warn",
                      a.severity === "info" && "text-[#3d8fd1]",
                    )}
                  >
                    {a.severity === "high_risk"
                      ? "High risk"
                      : a.severity === "warning"
                        ? "Warning"
                        : "Info"}
                  </span>
                  <span className="text-[10px] tabular-nums text-[#8fa3b5]">
                    {a.time}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {a.title}
                </p>
                <p className="text-xs text-[#8fa3b5]">{a.detail}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AlertIcon({ severity }: { severity: OpsAlert["severity"] }) {
  const color =
    severity === "high_risk"
      ? "text-bad"
      : severity === "warning"
        ? "text-warn"
        : "text-[#3d8fd1]";
  return (
    <span
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-xs font-bold",
        color,
      )}
      aria-hidden
    >
      {severity === "info" ? "i" : "!"}
    </span>
  );
}
