"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  balloonSummary,
  type BalloonPrediction,
  type BalloonProcessContext,
  type DrawingBalloon,
  type OpsDashboardSnapshot,
  type QualityTrendPoint,
} from "@/domain/opsDashboard";
import { usePublishCopilotContext } from "@/components/copilot/CopilotContext";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayout,
  readDashboardLayout,
  writeDashboardLayout,
} from "@/lib/dashboardLayout";
import { readBalloonLayoutLocal } from "@/lib/drawingBalloonCache";
import { BalloonDetail } from "./BalloonDetail";
import { BalloonSummary } from "./BalloonSummary";
import { DrawingCanvas } from "./DrawingCanvas";
import { type ActiveDrawing } from "./DrawingSourcePicker";
import { FailurePareto } from "./FailurePareto";
import { JobContextHeader } from "./JobContextHeader";
import { ModelConfidencePanel } from "./ModelConfidence";
import { OpsAlerts } from "./OpsAlerts";
import { OpsRecommendations } from "./OpsRecommendations";
import { OpsSidebar } from "./OpsSidebar";
import { ToolWearDashboard } from "./ToolWearDashboard";
import {
  confirmInspection, deferWearTask, requestSecondRun, saveQualitySpec, useWearAlertDemo, WearAlertPopover,
  type ToolWearAlert, type WearTask,
} from "./WearAlertDemo";
import { WearAlertPopup } from "./WearAlertPopup";
import { WearInspectionPopup } from "./WearInspectionPopup";
import { WearTaskBell } from "./WearTaskBell";
import type { WearEvent } from "./WearEventLog";
import { ToolWearTrend } from "./ToolWearTrend";
import { ProcessContextPanel } from "./ProcessContextPanel";
import { QualityTrend } from "./QualityTrend";
import { ColResizeHandle, ResizableBox } from "./ResizableBox";
import { linkBalloonDetailAndTrend } from "@/lib/qualityTrend";
import {
  applyTolerances,
  readTolerances,
  writeTolerances,
  type Tolerance,
} from "@/lib/balloonTolerance";
import {
  DEFAULT_QUALITY_BALLOON_ID,
  DEFAULT_SERIES_SPEC,
  demoBalloonRisk,
  qualityPredictionFromHistory,
  qualityRisk,
  qualityTrendFromHistory,
  seriesHistory,
} from "@/lib/qualityPredictions";

const DRAWING_STORAGE_KEY = "pqm.ops.activeDrawing";
const DRAWING_EVENT = "pqm-ops-drawing";

function subscribeDrawing(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(DRAWING_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(DRAWING_EVENT, handler);
  };
}

function readDrawingSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(DRAWING_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseDrawing(raw: string | null): ActiveDrawing | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActiveDrawing;
    if (parsed?.relPath && parsed?.kind) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Layout mirrors the A*STAR PQM operational mockup.
 * B1–B8 show finished records; B9 follows backend predictions.
 */
type InspectSnapshot = {
  balloonId: string;
  balloon: DrawingBalloon;
  prediction: BalloonPrediction | null;
  trend: QualityTrendPoint[];
};

export function OpsDashboard({ data: seed }: { data: OpsDashboardSnapshot }) {
  const [wearEvents, setWearEvents] = useState<WearEvent[]>([]);
  const seenWearEvents = useRef(new Set<string>());
  const appendWearEvents = useCallback((events: WearEvent[]) => {
    const fresh = events.filter(event => {
      if (seenWearEvents.current.has(event.id)) return false;
      seenWearEvents.current.add(event.id);
      return true;
    });
    if (fresh.length) {
      setWearEvents(previous => [...previous, ...fresh].sort((a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc)));
    }
  }, []);
  const resetWearEvents = useCallback(() => {
    seenWearEvents.current.clear();
    setWearEvents([]);
  }, []);
  const wearDemo = useWearAlertDemo(appendWearEvents, resetWearEvents);
  const [monitor, setMonitor] = useState<"quality" | "tool-wear">("quality");
  const seenTasks = useRef<Set<string> | null>(null);
  const [openedTask, setOpenedTask] = useState<{ id: string; manual: boolean } | null>(null);
  const [taskError, setTaskError] = useState("");
  const activeTask = wearDemo?.tasks?.find(task => task.id === openedTask?.id
    && (!task.deferred || openedTask.manual));
  useEffect(() => {
    const tasks = wearDemo?.tasks;
    if (!tasks) return;
    if (seenTasks.current === null) {
      seenTasks.current = new Set(tasks.map(task => task.id));
      return;
    }
    const fresh = tasks.filter(task => !seenTasks.current!.has(task.id));
    fresh.forEach(task => seenTasks.current!.add(task.id));
    const next = fresh.find(task => !task.deferred && (task.kind === "rework" || monitor === "quality"));
    if (next && !activeTask) { setTaskError(""); setOpenedTask({ id: next.id, manual: false }); }
    else if (openedTask && !tasks.some(task => task.id === openedTask.id)) setOpenedTask(null);
  }, [wearDemo?.tasks, monitor, activeTask, openedTask]);
  const postponeTask = useCallback(() => {
    if (!activeTask) return;
    void deferWearTask(activeTask.id).then(ok => {
      if (ok) { setOpenedTask(p => p?.id === activeTask.id ? null : p); setTaskError(""); }
      else setTaskError("Could not defer task. Please try again.");
    });
  }, [activeTask]);
  const openTask = useCallback((task: WearTask) => {
    setTaskError("");
    setOpenedTask({ id: task.id, manual: true });
    setMonitor(task.kind === "inspection" ? "quality" : "tool-wear");
  }, []);
  // "Yes, laser inspection": the backend notifies Kafka and waits for the controller's new wear values.
  const confirmWearAlerts = useCallback((alert: ToolWearAlert) => {
    void confirmInspection(alert.alertId).then(result => {
      if (!result) { setTaskError("Could not confirm inspection. Please try again."); return; }
      setOpenedTask(p => p?.id === `inspection:${alert.alertId}` ? null : p);
      setMonitor("tool-wear");
    });
  }, []);
  const secondRun = useCallback((alertId: string) => {
    void requestSecondRun(alertId).then(result => {
      if (result) { setOpenedTask(p => p?.id === `rework:${alertId}` ? null : p); setMonitor("quality"); }
      else setTaskError("Could not confirm rework. Please try again.");
    });
  }, []);
  // Start on the live quality balloon (B9): its trend is visible right away.
  const initialInspectId =
    seed.balloons.find((b) => b.id === DEFAULT_QUALITY_BALLOON_ID)?.id ??
    seed.job.currentBalloonId ??
    seed.balloons[0]?.id ??
    null;
  /** Drawing highlight + detail/trend — only changes on user balloon click. */
  const [inspectId, setInspectId] = useState<string | null>(initialInspectId);
  const [inspect, setInspect] = useState<InspectSnapshot | null>(() =>
    snapshotInspect(initialInspectId, seed.balloons, seed),
  );
  const [page, setPage] = useState(1);
  const [layoutBalloons, setLayoutBalloons] = useState<DrawingBalloon[] | null>(
    null,
  );
  const [dashLayout, setDashLayout] = useState<DashboardLayout>(
    DEFAULT_DASHBOARD_LAYOUT,
  );
  const drawingRaw = useSyncExternalStore(
    subscribeDrawing,
    readDrawingSnapshot,
    () => null,
  );
  const drawing = parseDrawing(drawingRaw);
  const drawingKey = drawing?.relPath ?? "";
  const prevDrawingKey = useRef(drawingKey);

  useEffect(() => {
    setDashLayout(readDashboardLayout());
  }, []);

  // Restore saved balloons for the active drawing on load / drawing change.
  useEffect(() => {
    if (prevDrawingKey.current !== drawingKey) {
      prevDrawingKey.current = drawingKey;
      setPage(1);
    }
    if (!drawingKey) {
      setLayoutBalloons(null);
      return;
    }
    const saved = readBalloonLayoutLocal(drawingKey);
    setLayoutBalloons(saved?.balloons ?? []);
  }, [drawingKey]);

  const setBoxHeight = useCallback((id: string, height: number) => {
    setDashLayout((prev) => {
      if (prev.locked) return prev;
      const next = {
        ...prev,
        heights: { ...prev.heights, [id]: height },
      };
      writeDashboardLayout(next);
      return next;
    });
  }, []);

  const resizeLeftCol = useCallback((dx: number) => {
    setDashLayout((prev) => {
      if (prev.locked) return prev;
      const next = {
        ...prev,
        cols: {
          ...prev.cols,
          left: Math.max(180, prev.cols.left + dx),
        },
      };
      writeDashboardLayout(next);
      return next;
    });
  }, []);

  const resizeRightCol = useCallback((dx: number) => {
    setDashLayout((prev) => {
      if (prev.locked) return prev;
      const next = {
        ...prev,
        cols: {
          ...prev.cols,
          right: Math.max(200, prev.cols.right - dx),
        },
      };
      writeDashboardLayout(next);
      return next;
    });
  }, []);

  const setLayoutLocked = useCallback((locked: boolean) => {
    setDashLayout((prev) => {
      const next = { ...prev, locked };
      writeDashboardLayout(next);
      return next;
    });
  }, []);

  const wide = useWideLayout();

  function handleDrawingSelect(next: ActiveDrawing) {
    try {
      localStorage.setItem(DRAWING_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(DRAWING_EVENT));
    } catch {
      /* ignore quota */
    }
  }

  /** Drawing roster; prediction results are applied after the backend snapshot arrives. */
  const templateBalloons = useMemo(() => {
    const base = layoutBalloons !== null ? layoutBalloons : seed.balloons;
    return base.map((b) => ({ ...b, risk: "not_machined" as const }));
  }, [layoutBalloons, seed.balloons]);

  const data = useMemo<OpsDashboardSnapshot>(() => ({
    ...seed,
    balloons: templateBalloons,
    alerts: [],
    recommendations: [],
  }), [seed, templateBalloons]);

  // Tolerances set from Selected Balloon Detail (kept in this browser).
  const [tolerances, setTolerances] = useState<Record<string, Tolerance>>({});
  useEffect(() => { setTolerances(readTolerances()); }, []);
  const handleToleranceChange = useCallback((balloonId: string, tolerance: Tolerance) => {
    // The quality balloon's tolerance lives on the backend, which uses it for every prediction trigger.
    if (balloonId === (wearDemo?.qualityBalloonId ?? DEFAULT_QUALITY_BALLOON_ID)) void saveQualitySpec(tolerance);
    setTolerances((previous) => {
      const next = { ...previous, [balloonId]: tolerance };
      writeTolerances(next);
      return next;
    });
  }, [wearDemo?.qualityBalloonId]);
  const backendQualitySpec = wearDemo?.qualitySpec;
  const fixedSeries = useMemo(() => seriesHistory(wearDemo?.fixedQualitySeries), [wearDemo?.fixedQualitySeries]);
  const hasFixedSeries = fixedSeries.some((point) => typeof point.quality === "number");
  const cutting = wearDemo?.cutting;
  const allBalloons = useMemo(() => {
    const qualityId = wearDemo?.qualityBalloonId ?? DEFAULT_QUALITY_BALLOON_ID;
    // The other drawing balloons are treated as finished and show the fixed series with this default tolerance
    // (until the user sets their own).
    const withDefaults = hasFixedSeries
      ? data.balloons.map((b) => b.source === "manual" && b.id !== qualityId && !tolerances[b.id]
        ? { ...b, ...(wearDemo?.fixedQualitySpec ?? DEFAULT_SERIES_SPEC) } : b)
      : data.balloons;
    const toleranced = applyTolerances(withDefaults, backendQualitySpec
      ? { ...tolerances, [qualityId]: backendQualitySpec } : tolerances);
    // B9's demo colour follows the run phase; fixed balloons follow their quality values.
    const fixedQuality = fixedSeries.findLast((point) => typeof point.quality === "number")?.quality;
    return toleranced.map((b) => {
      if (b.id === qualityId) return { ...b, risk: demoBalloonRisk(cutting) };
      const value = b.source === "manual" ? fixedQuality : undefined;
      return typeof value === "number" ? { ...b, risk: qualityRisk(value, b) } : b;
    });
  }, [data.balloons, tolerances, backendQualitySpec, wearDemo?.qualityBalloonId, wearDemo?.fixedQualitySpec, cutting, hasFixedSeries, fixedSeries]);

  const pageBalloons = useMemo(
    () => allBalloons.filter((b) => (b.page ?? 1) === page),
    [allBalloons, page],
  );

  // Process context follows the user's selection; no simulated machining clock.
  const processBalloon = useMemo(
    () => allBalloons.find((b) => b.id === inspectId) ?? null,
    [allBalloons, inspectId],
  );

  const process = processBalloon
    ? resolveProcess(data, processBalloon.id)
    : null;

  function handleSelectBalloon(id: string) {
    const b = allBalloons.find((x) => x.id === id);
    if (b?.page && b.page !== page) setPage(b.page);
    setInspectId(id);
    setInspect(snapshotInspect(id, allBalloons, data));
  }

  // The live quality balloon (B9) is driven by the backend's prediction series instead of simulated data.
  // The other manual balloons show the whole series as a finished record (it never changes).
  const qualityHistory = wearDemo?.history;
  const qualityBalloonId = wearDemo?.qualityBalloonId ?? DEFAULT_QUALITY_BALLOON_ID;
  // Always the balloon with the user's tolerance applied (inspect holds a snapshot from selection time).
  const inspectBalloon = useMemo(
    () => (inspect ? allBalloons.find((b) => b.id === inspect.balloon.id) ?? inspect.balloon : null),
    [inspect, allBalloons],
  );
  const isQualityBalloon = inspectBalloon != null && inspectBalloon.id === qualityBalloonId;
  const isFixedSeriesBalloon = !isQualityBalloon && hasFixedSeries && inspectBalloon?.source === "manual";
  const qualityTrend = useMemo(
    () => (inspectBalloon && (isQualityBalloon || isFixedSeriesBalloon)
      ? qualityTrendFromHistory(isQualityBalloon ? qualityHistory ?? [] : fixedSeries, inspectBalloon,
          isQualityBalloon ? wearDemo?.lastQc : undefined)
      : []),
    [isQualityBalloon, isFixedSeriesBalloon, inspectBalloon, qualityHistory, fixedSeries, wearDemo?.lastQc],
  );
  const detailPrediction = useMemo(
    () => (isQualityBalloon && inspectBalloon
      ? qualityPredictionFromHistory(qualityHistory ?? [], inspectBalloon, wearDemo?.lastQc?.value, wearDemo?.lastQc?.timestampUtc)
      : isFixedSeriesBalloon && inspectBalloon
        ? qualityPredictionFromHistory(fixedSeries, inspectBalloon)
        : inspect?.prediction ?? null),
    [isQualityBalloon, isFixedSeriesBalloon, inspect, inspectBalloon, qualityHistory, fixedSeries, wearDemo?.lastQc?.value, wearDemo?.lastQc?.timestampUtc],
  );
  const detailBalloon = useMemo(
    () => (isQualityBalloon && inspectBalloon && detailPrediction
      ? { ...inspectBalloon, risk: qualityRisk(detailPrediction.predictedValue, inspectBalloon) }
      : inspectBalloon),
    [isQualityBalloon, inspectBalloon, detailPrediction],
  );

  const summary = useMemo(() => balloonSummary(allBalloons), [allBalloons]);

  const copilotCtx = useMemo(
    () => ({
      selectedBalloonId: inspect?.balloonId ?? inspectId,
      selectedBalloonCode: inspect?.balloon.code ?? null,
      selectedCharacteristic: inspect?.balloon.characteristic ?? null,
      selectedRisk: inspect?.balloon.risk ?? null,
      predictedValue: inspect?.prediction?.predictedValue ?? null,
      passProbability: inspect?.prediction?.passProbability ?? null,
      simPhase: "review" as const,
      simLabel: "B1–B8 completed · B9 follows backend prediction",
      canLoadNext: false,
      summary: {
        pass: summary.pass,
        warning: summary.warning,
        highRisk: summary.highRisk,
        notMachined: summary.notMachined,
        total: summary.total,
      },
      highRiskCodes: allBalloons
        .filter((b) => b.risk === "high_risk")
        .map((b) => b.code),
      warningCodes: allBalloons
        .filter((b) => b.risk === "warning")
        .map((b) => b.code),
      alerts: data.alerts.map((a) => ({
        title: a.title,
        detail: a.detail,
        balloonId: a.balloonId,
      })),
      recommendations: data.recommendations.map((r) => ({
        title: r.title,
        detail: r.detail,
        priority: r.priority,
        balloonId: r.balloonId,
      })),
    }),
    [
      inspect,
      inspectId,
      summary,
      allBalloons,
      data.alerts,
      data.recommendations,
    ],
  );
  usePublishCopilotContext(copilotCtx);

  const monitorTabs = (
    <div className="flex gap-1 rounded-lg border border-[#2a3a4a] bg-[#0e1620] p-1" role="tablist" aria-label="Monitoring view">
      {([['quality', 'Product Quality'], ['tool-wear', 'Tool Wear']] as const).map(([id, label]) => (
        <button key={id} id={`tab-${id}`} role="tab" aria-selected={monitor === id} aria-controls={`monitor-${id}`} onClick={() => setMonitor(id)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${monitor === id ? 'bg-[#23425b] text-[#a5d8fa] shadow-sm' : 'text-[#8197aa] hover:bg-[#192a39] hover:text-[#c1d6e6]'}`}>{label}</button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] bg-[#0b111b] text-foreground">
      <WearAlertPopup alerts={activeTask?.alert ? [activeTask.alert] : []} destinations={wearDemo?.destinations?.filter(name => name !== "kafka")}
        onConfirm={confirmWearAlerts} onDismiss={postponeTask} error={taskError} />
      <WearInspectionPopup inspection={activeTask?.inspection} onSecondRun={secondRun} onDismiss={postponeTask} error={taskError} />
      <OpsSidebar onMonitorChange={setMonitor} />
      <div className="flex min-w-0 flex-1 flex-col">
        <JobContextHeader
          job={data.job}
          selected={processBalloon}
          drawing={drawing}
          onDrawingSelect={handleDrawingSelect}
          simLabel={wearDemo?.cutting?.status === "cutting" ? "B9 · Cutting" : "B1–B8 completed · B9 live prediction"}
          layoutLocked={dashLayout.locked}
          onLayoutLockedChange={setLayoutLocked}
          monitorTabs={monitorTabs}
          actions={monitor === "quality" ? <WearAlertPopover snapshot={wearDemo} /> : undefined}
          notifications={<WearTaskBell tasks={wearDemo?.tasks ?? []} onOpen={openTask} />}
        />

        <div className="flex-1 overflow-auto p-3">
          <div id="monitor-tool-wear" role="tabpanel" aria-labelledby="tab-tool-wear" hidden={monitor !== 'tool-wear'}>
            <ToolWearDashboard currentTool={data.job.currentTool} locked={dashLayout.locked} wearDemo={wearDemo} events={wearEvents} onEvents={appendWearEvents} />
          </div>
          <div id="monitor-quality" role="tabpanel" aria-labelledby="tab-quality" hidden={monitor !== 'quality'}>
          <div className="flex min-w-0 flex-col items-stretch gap-3 xl:flex-row xl:gap-0">
            <div
              className="flex w-full flex-col gap-3 xl:shrink-0"
              style={wide ? { width: dashLayout.cols.left } : undefined}
            >
              <DashBox
                id="summary"
                height={dashLayout.heights.summary}
                minHeight={140}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <BalloonSummary
                  balloons={allBalloons}
                  overallQuality={allBalloons.some((b) => b.risk === "high_risk") ? "poor"
                    : allBalloons.some((b) => b.risk === "warning") ? "watch" : "good"}
                  predictionConfidence={
                    data.modelConfidence.predictionConfidence
                  }
                />
              </DashBox>
              <DashBox
                id="process"
                height={dashLayout.heights.process}
                minHeight={160}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <ProcessContextPanel
                  balloonCode={processBalloon?.code ?? null}
                  context={process}
                />
              </DashBox>
              <DashBox
                id="recommendations"
                height={dashLayout.heights.recommendations}
                minHeight={140}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <OpsRecommendations
                  items={data.recommendations}
                  selected={inspect?.balloon ?? null}
                  onFocusBalloon={handleSelectBalloon}
                />
              </DashBox>
            </div>

            {wide ? (
              <ColResizeHandle
                locked={dashLayout.locked}
                onDrag={resizeLeftCol}
              />
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden [&>*]:min-w-0 [&>*]:max-w-full" style={{ minWidth: 0 }}>
              <DashBox
                id="drawing"
                height={dashLayout.heights.drawing}
                minHeight={280}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <DrawingCanvas
                  seedBalloons={seed.balloons}
                  balloons={pageBalloons}
                  allBalloons={allBalloons}
                  selectedId={inspectId}
                  machiningId={wearDemo?.cutting?.status === "cutting" ? qualityBalloonId : null}
                  onSelect={handleSelectBalloon}
                  drawing={drawing}
                  page={page}
                  onPageChange={setPage}
                  onBalloonsChange={setLayoutBalloons}
                />
              </DashBox>
              <DashBox
                id="pareto"
                height={dashLayout.heights.pareto}
                minHeight={140}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <FailurePareto items={data.failurePareto} />
              </DashBox>
              <DashBox
                id="confidence"
                height={dashLayout.heights.confidence}
                minHeight={140}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <ModelConfidencePanel
                  data={data.modelConfidence}
                  balloonConfidence={inspect?.prediction?.confidence ?? null}
                />
              </DashBox>
            </div>

            {wide ? (
              <ColResizeHandle
                locked={dashLayout.locked}
                onDrag={resizeRightCol}
              />
            ) : null}

            <div
              className="flex w-full flex-col gap-3 xl:shrink-0"
              style={wide ? { width: dashLayout.cols.right } : undefined}
            >
              <DashBox
                id="detail"
                height={dashLayout.heights.detail}
                minHeight={160}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <BalloonDetail
                  balloon={detailBalloon}
                  prediction={detailPrediction}
                  onToleranceChange={handleToleranceChange}
                  emptyHint={isQualityBalloon
                    ? "No prediction yet — trigger one from the flask icon in the top bar."
                    : undefined}
                />
              </DashBox>
              <DashBox
                id="trend"
                height={dashLayout.heights.trend}
                minHeight={180}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <QualityTrend
                  balloonCode={inspectBalloon?.code ?? null}
                  characteristic={inspectBalloon?.characteristic}
                  points={qualityTrend}
                  emptyMessage={isQualityBalloon
                    ? "No prediction yet — trigger one from the flask icon in the top bar."
                    : "No trend series for this balloon."}
                />
              </DashBox>
              <DashBox
                id="toolWearTrend"
                height={dashLayout.heights.toolWearTrend}
                minHeight={180}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <ToolWearTrend snapshot={wearDemo} />
              </DashBox>
              <DashBox
                id="alerts"
                height={dashLayout.heights.alerts}
                minHeight={140}
                locked={dashLayout.locked}
                onHeightChange={setBoxHeight}
              >
                <OpsAlerts
                  alerts={[
                    ...(wearDemo?.alerts ?? []).map(alert => alert.kind === "quality"
                      ? {
                        id: alert.alertId,
                        severity: "high_risk" as const,
                        title: `Quality alert · ${alert.balloonId.toUpperCase()}`,
                        detail: `Predicted ${alert.value} mm ${alert.side === "upper" ? ">" : "<"} ${alert.side === "upper" ? "USL" : "LSL"} ${Math.round(alert.limit * 1e6) / 1e6} mm`,
                        time: new Date(alert.timestampUtc).toLocaleTimeString(),
                        balloonId: alert.balloonId,
                      }
                      : {
                        id: alert.alertId,
                        severity: "high_risk" as const,
                        title: `Tool wear alert · Tool ${alert.prediction.toolNo}`,
                        detail: alert.metrics.map(metric =>
                          `${metric}: ${alert.prediction[metric]} mm > ${alert.thresholds[metric]} mm`
                        ).join(" · "),
                        time: new Date(alert.timestampUtc).toLocaleTimeString(),
                      }),
                    ...data.alerts,
                  ]}
                  onFocusBalloon={handleSelectBalloon}
                />
              </DashBox>
            </div>
          </div>
        </div>

        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#243141] bg-[#0b111b] px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[#6b7c8f]">
          <div className="flex flex-wrap gap-4">
            <Source label="FOCAS" />
            <Source label="Sensors" />
            <Source label="G-code" />
            <Source label="CMM (sampling)" />
            <span className="normal-case tracking-normal text-[#8fa3b5]">
              {monitor === 'quality' ? 'B1–B8 fixed completed results · B9 follows backend prediction' : 'Tool wear · diameter and tool length predictions'}
            </span>
          </div>
          <p>All times are synchronized to machine time</p>
        </footer>
      </div>
    </div>
  );
}

function DashBox({
  id,
  height,
  minHeight,
  locked = false,
  onHeightChange,
  children,
}: {
  id: string;
  height: number;
  minHeight: number;
  locked?: boolean;
  onHeightChange: (id: string, height: number) => void;
  children: ReactNode;
}) {
  return (
    <ResizableBox
      id={id}
      height={height}
      minHeight={minHeight}
      locked={locked}
      onHeightChange={(h) => onHeightChange(id, h)}
    >
      {children}
    </ResizableBox>
  );
}

function useWideLayout() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return wide;
}

function Source({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-good" />
      {label}
    </span>
  );
}

function resolveProcess(
  data: OpsDashboardSnapshot,
  balloonId: string,
): BalloonProcessContext | null {
  return data.processByBalloon[balloonId] ?? null;
}

function snapshotInspect(
  id: string | null,
  balloons: DrawingBalloon[],
  data: OpsDashboardSnapshot,
): InspectSnapshot | null {
  if (!id) return null;
  const balloon = balloons.find((b) => b.id === id);
  if (!balloon) return null;

  const linked = linkBalloonDetailAndTrend(
    balloon,
    data.predictions[id] ?? null,
    data.trendsByBalloon[id],
  );

  return {
    balloonId: id,
    balloon: { ...balloon },
    prediction: linked.prediction,
    trend: linked.trend,
  };
}
