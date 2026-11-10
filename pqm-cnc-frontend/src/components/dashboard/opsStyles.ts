import type {
  AlertSeverity,
  BalloonRisk,
  RecPriority,
} from "@/domain/opsDashboard";

export const riskDot: Record<BalloonRisk, string> = {
  pass: "bg-good border-good",
  warning: "bg-warn border-warn",
  high_risk: "bg-bad border-bad",
  not_machined: "bg-transparent border-[#5a6b7a] text-[#5a6b7a]",
};

export const riskText: Record<BalloonRisk, string> = {
  pass: "text-good",
  warning: "text-warn",
  high_risk: "text-bad",
  not_machined: "text-[#8fa3b5]",
};

export const riskLabel: Record<BalloonRisk, string> = {
  pass: "PASS",
  warning: "WARNING",
  high_risk: "HIGH RISK",
  not_machined: "NOT MACHINED",
};

export const recTone: Record<RecPriority, string> = {
  high: "border-bad/40 bg-bad/[0.07]",
  recommended: "border-warn/40 bg-warn/[0.07]",
  info: "border-[#3d8fd1]/40 bg-[#3d8fd1]/[0.07]",
  ok: "border-good/40 bg-good/[0.07]",
};

export const recPill: Record<RecPriority, string> = {
  high: "bg-bad text-[#0b111b]",
  recommended: "bg-warn text-[#0b111b]",
  info: "bg-[#3d8fd1] text-[#0b111b]",
  ok: "bg-good text-[#0b111b]",
};

export const alertTone: Record<AlertSeverity, string> = {
  high_risk: "border-l-bad",
  warning: "border-l-warn",
  info: "border-l-[#3d8fd1]",
};

/** Card chrome matching the PQM mockup panels. */
export const panelClass =
  "flex flex-col rounded-xl border border-[#243141] bg-[#121a24] shadow-[0_1px_0_rgba(255,255,255,0.02)]";

export const panelTitle =
  "text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9eb0c0]";

export const panelHeader =
  "flex items-center justify-between gap-2 border-b border-[#243141] px-3.5 py-2.5";

export const panelBody = "flex flex-1 flex-col p-3.5";
