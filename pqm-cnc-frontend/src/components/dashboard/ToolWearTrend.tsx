"use client";

import { TrendPanel } from "./TrendPanel";
import type { WearAlertSnapshot } from "./WearAlertDemo";
import { WearPredictionChart } from "./WearPredictionChart";

const TOOL_LABEL = "T25";

/** Diameter and length wear predictions for the fixed demo tool (sliding window), with backend thresholds. */
export function ToolWearTrend({ snapshot = null }: { snapshot?: WearAlertSnapshot | null }) {
  const history = snapshot?.history ?? [];
  const thresholds = snapshot?.thresholds;
  const latest = history.at(-1);
  const latestExceeded = latest && thresholds
    ? latest.diameter > thresholds.diameter || latest.length > thresholds.length
    : false;

  return (
    <TrendPanel id="tool-wear-trend" title={`Tool wear trend · ${TOOL_LABEL}`}
      description={<>{history.length} predicted · mock data · last 10 shown · mm</>}
      status={latest ? (
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${latestExceeded ? "bg-bad" : "bg-good"} text-[#0b1724]`}>
          {latestExceeded ? "High wear" : "Within limit"}
        </span>
      ) : null}>
      <WearPredictionChart points={history} thresholds={thresholds}
        emptyMessage="No prediction yet — trigger one from the flask icon in the top bar." />
    </TrendPanel>
  );
}
