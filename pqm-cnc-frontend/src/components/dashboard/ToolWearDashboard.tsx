"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useControllerData, controllerOffset, type ControllerRow } from "@/lib/useControllerData";
import { Panel } from "./Panel";
import { ToolImageBlock } from "./ToolImageBlock";
import { CctvBlock } from "./CctvBlock";
import { ResizableToolBlock } from "./ResizableToolBlock";
import { ColResizeHandle } from "./ResizableBox";
import { useWearHistory } from "@/lib/useWearHistory";
import { WearPredictionChart, type MeasuredWear } from "./WearPredictionChart";
import { toolKey, toolLabel } from "@/lib/toolNumber";
import { toolWearMeasurements } from "@/lib/toolWearMeasurements";
import { WearEventLog, type WearEvent } from "./WearEventLog";
import { WearAlertForm, requestWearRefresh, type WearAlertSnapshot } from "./WearAlertDemo";

const DEFAULT_TOOL = "25";
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 7;
const DEFAULT_HISTORY_DAYS = 1;

/** YYYY-MM-DD of a moment in the browser's local time zone (the chart labels are local too). */
function localDate(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Query bounds for a range of local calendar days: local midnight of the first day up to (excluding) local midnight
 * after the last day. Local, not UTC, so the data matches the dates the chart labels show.
 */
function dateBounds(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = end.split("-").map(Number) as [number, number, number];
  const from = new Date(sy, sm - 1, sd).getTime();
  // Never longer than the backend's 7 days, even across a daylight-saving change.
  const to = Math.min(new Date(ey, em - 1, ed + 1).getTime(), from + HISTORY_DAYS * DAY_MS);
  return { start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}

const METRICS = [
  { key: "diameter", axis: "x", label: "Diameter wear", color: "#38bdf8" },
  { key: "length", axis: "z", label: "Tool length wear", color: "#c4a0ff" },
] as const;

/** Controller readouts and wear history for the selected tool. */
export function ToolWearDashboard({ locked = false, wearDemo = null, events = [], onEvents }: {
  currentTool: string;
  locked?: boolean;
  wearDemo?: WearAlertSnapshot | null;
  events?: readonly WearEvent[];
  onEvents?: (events: WearEvent[]) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastLoggedWear = useRef(new Map<string, { timestamp: number; x: number | null; z: number | null }>());
  const logSamples = useCallback((rows: ControllerRow[], receivedAt: string, machine: string) => {
    if (!onEvents) return;
    const received = rows.flatMap(row => {
      const x = controllerOffset(row, "x").wear;
      const z = controllerOffset(row, "z").wear;
      if (x === null && z === null) return [];
      const key = JSON.stringify([machine, toolKey(row.tool_no)]);
      const previous = lastLoggedWear.current.get(key);
      const timestamp = Date.parse(row.timestamp);
      if (previous && timestamp < previous.timestamp) return [];
      // Missing readings do not erase the last valid value of either axis.
      const next = { timestamp, x: x ?? previous?.x ?? null, z: z ?? previous?.z ?? null };
      lastLoggedWear.current.set(key, next);
      if (previous && next.x === previous.x && next.z === previous.z) return [];
      const values = [
        x === null ? null : `X wear ${x} mm`,
        z === null ? null : `Z wear ${z} mm`,
      ].filter(Boolean);
      return [{
        id: JSON.stringify(["actual-wear", machine, toolKey(row.tool_no), row.timestamp]),
        label: "Actual wear received",
        toolNo: row.tool_no ?? null,
        timestampUtc: receivedAt,
        detail: values.join(" · "),
      }];
    });
    if (received.length) onEvents(received);
  }, [onEvents]);
  const { latestByTool, status: controllerStatus } = useControllerData(true, logSamples);
  const [selectedTool, setSelectedTool] = useState(DEFAULT_TOOL);
  const [dates, setDates] = useState({ start: "", end: "" });
  const [bounds, setBounds] = useState<{ start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const history = useWearHistory(DEFAULT_HISTORY_DAYS * 24 * 60, bounds?.start, bounds?.end, selectedTool, bounds !== null);
  const [columns, setColumns] = useState({ tools: 240, diameter: 50, history: 50 });
  const gridRef = useRef<HTMLDivElement>(null);
  const controller = latestByTool[selectedTool];
  // Predictions for the selected tool inside the chosen date range (the demo only predicts one tool).
  const rangeStart = bounds ? Date.parse(bounds.start) : -Infinity;
  const rangeEnd = bounds ? Date.parse(bounds.end) : Infinity;
  const predictions = (wearDemo?.history ?? []).filter(point => {
    const t = Date.parse(point.timestampUtc);
    return toolKey(point.toolNo) === selectedTool && t >= rangeStart && t < rangeEnd;
  });
  // Exactly one inspection measurement per demo, independently of controller history polling.
  const measurement = wearDemo?.toolMeasurement;
  const measurementTime = measurement ? Date.parse(measurement.timestampUtc) : NaN;
  const measured: MeasuredWear[] = toolWearMeasurements(predictions, measurement && toolKey(measurement.toolNo) === selectedTool
    && measurementTime >= rangeStart && measurementTime < rangeEnd
    ? measurement : undefined);
  const historyData = history.data;
  const tools = [...new Set([DEFAULT_TOOL, ...Object.keys(latestByTool), ...history.discoveredTools])];
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("pqm.toolWear.columns") ?? "null");
        if (saved && Number.isFinite(saved.tools) && saved.tools >= 180 && Number.isFinite(saved.diameter) && saved.diameter >= 10 && saved.diameter <= 90) {
          const history = Number.isFinite(saved.history) && saved.history >= 10 && saved.history <= 90 ? saved.history : 50;
          setColumns({ tools: saved.tools, diameter: saved.diameter, history });
        }
      } catch { /* defaults */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = Date.now();
      const end = localDate(now);
      const start = localDate(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() - (DEFAULT_HISTORY_DAYS - 1)).getTime());
      setDates({ start, end });
      setBounds(dateBounds(start, end));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  /** Validate a date range and make it the active query range. Returns false (and shows why) when it is invalid. */
  function applyDates(next: { start: string; end: string }) {
    if (!next.start || !next.end || next.end < next.start) {
      setRangeError("Choose a start date on or before the end date.");
      return false;
    }
    const nextBounds = dateBounds(next.start, next.end);
    if ((Date.parse(`${next.end}T00:00:00Z`) - Date.parse(`${next.start}T00:00:00Z`)) / DAY_MS + 1 > HISTORY_DAYS) {  // calendar days
      setRangeError("Choose a range of up to 7 days.");
      return false;
    }
    setRangeError(null);
    setBounds(nextBounds);
    return true;
  }

  function changeDate(field: "start" | "end", value: string) {
    const next = { ...dates, [field]: value };
    setDates(next);
    applyDates(next);  // a valid new range is requested once
  }

  /** Request the history again for the dates currently shown, and re-read the prediction snapshot. */
  function refresh() {
    if (!applyDates(dates)) return;
    history.reload();
    requestWearRefresh();
  }

  function resizeColumns(kind: "tools" | "diameter" | "history", delta: number) {
    if (locked) return;
    const availableWidth = gridRef.current?.getBoundingClientRect().width || 800;
    setColumns((prev) => {
      const next = kind === "tools"
        ? { ...prev, tools: Math.max(180, prev.tools + delta) }
        : { ...prev, [kind]: Math.max(10, Math.min(90, prev[kind] + delta / Math.max(1, availableWidth - 8) * 100)) };
      try { localStorage.setItem("pqm.toolWear.columns", JSON.stringify(next)); } catch { /* unavailable */ }
      return next;
    });
  }

  return (
    <div className="space-y-4" id="tool-wear">


      <div className="grid grid-cols-1 items-start gap-y-2 lg:grid-cols-[var(--tools-width)_8px_minmax(0,1fr)]" style={{ "--tools-width": `${columns.tools}px` } as CSSProperties}>
        <ResizableToolBlock id="tools" width={240} height={500} locked={locked} fillWidth>
        <Panel title="Tools" titleRight={
          <button type="button" aria-label="Prediction alert thresholds" title="Prediction alert thresholds"
            aria-expanded={settingsOpen} aria-controls="tool-wear-thresholds"
            onClick={() => setSettingsOpen(open => !open)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-sm leading-none text-[#8296a8] hover:bg-[#192a39] hover:text-[#c1d6e6] focus-visible:outline focus-visible:outline-[#8296a8]">
            <span aria-hidden="true">⚙</span>
          </button>
        }>
          <div id="tool-wear-thresholds" hidden={!settingsOpen} className="shrink-0">
            {settingsOpen && <div className="mb-3 border-b border-[#243141] pb-2">
              <WearAlertForm snapshot={wearDemo} settings />
            </div>}
          </div>
          <ul aria-label="Tool selection" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1">
            {tools.map(tool => {
              const sample = latestByTool[tool];
              const selected = tool === selectedTool;
              return (
                <li key={tool}>
                  <button
                    type="button"
                    aria-label={toolLabel(tool)}
                    aria-pressed={selected}
                    onClick={() => setSelectedTool(tool)}
                    className={`w-full cursor-pointer rounded-lg border border-l-[3px] px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      selected
                        ? "border-sky-400/50 border-l-sky-400 bg-[#142c40]"
                        : "border-[#293b4c] bg-[#0e1823] hover:border-[#496177] hover:bg-[#172636]"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-foreground">{toolLabel(tool)}</strong>
                      {selected && <span className="text-[10px] text-sky-300">Selected</span>}
                    </span>
                    {sample ? (
                      <>
                        <span className="mt-2 grid grid-cols-2 gap-2">
                          {METRICS.map(metric => {
                            const wear = controllerOffset(sample, metric.axis).wear;
                            return (
                              <span key={metric.key}>
                                <span className="block text-[10px] text-[#8296a8]">{metric.axis.toUpperCase()} wear</span>
                                <span className="text-xs font-medium tabular-nums" style={{ color: metric.color }}>
                                  {wear === null ? "—" : `${wear.toFixed(3)} mm`}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                        <span className="mt-1.5 block text-[10px] text-[#8296a8]">
                          Sampled <time dateTime={sample.timestamp}>{new Date(sample.timestamp).toLocaleString()}</time>
                        </span>
                        <span className="block text-[10px] text-[#8296a8]">
                          Received <time dateTime={sample.receivedAt}>{new Date(sample.receivedAt).toLocaleString()}</time>
                        </span>
                      </>
                    ) : <span className="mt-1.5 block text-[10px] text-[#8296a8]">No controller sample yet</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        </ResizableToolBlock>
        <div className="hidden h-full lg:flex"><ColResizeHandle locked={locked} onDrag={(dx) => resizeColumns("tools", dx)} /></div>

        <div ref={gridRef} className="grid min-w-0 items-start gap-y-2" style={{ gridTemplateColumns: `minmax(0, ${columns.diameter}fr) 8px minmax(0, ${100 - columns.diameter}fr)` } as CSSProperties}>
          <WearEventLog events={events} />
          {METRICS.map((metric) => {
            const values = controllerOffset(controller, metric.key === "diameter" ? "x" : "z");

            return <div key={metric.key} className="contents"><ResizableToolBlock id={`${metric.key}-health`} width={320} height={190} locked={locked} fillWidth><section aria-label={`${metric.label} health`} className="h-full overflow-auto rounded-xl border border-[#2b4052] bg-[#101e2b] p-4">
              <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: metric.color }}>{metric.label}</h3><span className="text-[10px] uppercase text-[#8296a8]">{values.wear !== null ? "Controller" : "No data"}</span></div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2"><p className="text-4xl font-semibold tabular-nums">{values.wear?.toFixed(3) ?? "—"}<span className="ml-2 text-sm font-normal text-[#70889c]">mm</span></p>
              <div className="flex flex-col gap-1 text-[11px] tabular-nums text-[#8296a8]"><span>Geometry {values.geometry?.toFixed(3) ?? "—"} mm</span><span>Offset {values.offset?.toFixed(3) ?? "—"} mm</span></div></div>

              <p className="mt-2 text-[10px] text-[#8296a8]">{`${metric.key === "diameter" ? "xWearMm" : "zWearMm"} · controller ${controllerStatus} · Offset = geometry + wear`}</p>
            </section></ResizableToolBlock>{metric.key === 'diameter' && <div className="flex self-stretch"><ColResizeHandle locked={locked} onDrag={(dx) => resizeColumns("diameter", dx)} /></div>}</div>;
          })}
          <div className="col-span-3 grid min-w-0 items-start gap-y-2 xl:grid-cols-[var(--wear-history-columns)]"
            style={{ "--wear-history-columns": `minmax(0, ${columns.history}fr) 8px minmax(0, ${100 - columns.history}fr)` } as CSSProperties}>
            <ResizableToolBlock id="wear-history" width={520} height={380} locked={locked} fillWidth>
              <Panel title={`Predicted wear history · ${toolLabel(selectedTool)}`} bodyClassName="flex flex-col gap-2" titleRight={
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-[#8296a8]">
                  <input aria-label="Wear history start date" type="date" value={dates.start}
                    onChange={event => changeDate("start", event.target.value)}
                    className="min-w-0 rounded border border-[#314254] bg-[#0c1722] px-1 py-1 text-[#c6d7e4]" />
                  <span aria-hidden="true">–</span>
                  <input aria-label="Wear history end date" type="date" value={dates.end}
                    onChange={event => changeDate("end", event.target.value)}
                    className="min-w-0 rounded border border-[#314254] bg-[#0c1722] px-1 py-1 text-[#c6d7e4]" />
                  <button type="button" onClick={refresh} disabled={history.fetching} aria-label="Refresh wear history"
                    className="shrink-0 rounded border border-[#385064] px-2 py-1 text-[10px] text-[#a5d8fa] hover:bg-[#152738] disabled:opacity-50">
                    {history.fetching ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              }>
                {rangeError && <p role="alert" className="text-xs text-amber-400">{rangeError}</p>}
                {history.loading && <p className="text-xs text-[#8296a8]">Loading measured history…</p>}
                <WearPredictionChart points={predictions} thresholds={wearDemo?.thresholds} measured={measured} xMode="time"
                  emptyMessage="No prediction or measured value in this range." />
                <p className="shrink-0 text-[10px] text-[#70889c]">
                  {predictions.length} predicted · {measured.length} measured
                  {historyData?.end ? ` · Through ${new Date(historyData.end).toLocaleString()}` : ""}
                </p>
              </Panel>
            </ResizableToolBlock>
            <div className="hidden self-stretch xl:flex">
              <ColResizeHandle locked={locked} onDrag={dx => resizeColumns("history", dx)} />
            </div>
            <ResizableToolBlock id="photo" width={520} height={380} locked={locked} fillWidth>
              <div className="grid h-full min-h-0 grid-cols-2 gap-3">
                <div className="min-h-0 min-w-0"><ToolImageBlock /></div>
                <div className="min-h-0 min-w-0"><CctvBlock /></div>
              </div>
            </ResizableToolBlock>
          </div>
        </div>
      </div>

    </div>
  );
}

