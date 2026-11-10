"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useControllerData, controllerOffset } from "@/lib/useControllerData";
import { Panel } from "./Panel";
import { ToolImageBlock } from "./ToolImageBlock";
import { ResizableToolBlock } from "./ResizableToolBlock";
import { ColResizeHandle } from "./ResizableBox";
import { useWearHistory } from "@/lib/useWearHistory";
import { WearHistoryChart } from "./WearHistoryChart";

const METRICS = [
  { key: "diameter", axis: "x", label: "Diameter wear", color: "#38bdf8" },
  { key: "length", axis: "z", label: "Tool length wear", color: "#c4a0ff" },
] as const;

/** Single-tool controller readouts and real hot-store history; null tool numbers are retained. */
export function ToolWearDashboard({ locked = false }: { currentTool: string; locked?: boolean }) {
  const { rows, status: controllerStatus } = useControllerData();
  const [minutes, setMinutes] = useState(60);
  const [bounds, setBounds] = useState<{ start: string; end: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const history = useWearHistory(minutes, bounds?.start, bounds?.end);
  const [columns, setColumns] = useState({ tools: 240, diameter: 50 });
  const gridRef = useRef<HTMLDivElement>(null);
  const controller = rows.at(-1);
  const toolNo = controller?.tool_no ?? history.data?.data.at(-1)?.toolNo;
  const toolLabel = toolNo != null ? `Tool ${toolNo}` : "Tool · number unavailable";
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("pqm.toolWear.columns") ?? "null");
        if (saved && Number.isFinite(saved.tools) && saved.tools >= 180 && Number.isFinite(saved.diameter) && saved.diameter >= 10 && saved.diameter <= 90) setColumns(saved);
      } catch { /* defaults */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  function resizeColumns(kind: "tools" | "diameter", delta: number) {
    if (locked) return;
    const availableWidth = gridRef.current?.getBoundingClientRect().width || 800;
    setColumns((prev) => {
      const next = kind === "tools" ? { ...prev, tools: Math.max(180, prev.tools + delta) } : { ...prev, diameter: Math.max(10, Math.min(90, prev.diameter + delta / availableWidth * 100)) };
      try { localStorage.setItem("pqm.toolWear.columns", JSON.stringify(next)); } catch { /* unavailable */ }
      return next;
    });
  }

  return (
    <div className="space-y-4" id="tool-wear">


      <div className="grid grid-cols-1 items-start gap-y-2 lg:grid-cols-[var(--tools-width)_8px_minmax(0,1fr)]" style={{ "--tools-width": `${columns.tools}px` } as CSSProperties}>
        <ResizableToolBlock id="tools" width={240} height={500} locked={locked} fillWidth>
        <Panel title="Tool" titleRight={<span className="text-[10px] text-[#8296a8]">Single tool</span>}>
          <p className="text-base font-semibold">{toolLabel}</p>
          <p className="mt-2 text-[11px] text-[#8296a8]">Records with an unknown tool number are included.</p>
          <label className="mt-5 block text-xs text-[#8296a8]">History range
            <select aria-label="Wear history range" value={bounds ? "custom" : String(minutes)} onChange={event => {
              if (event.target.value !== "custom") { setMinutes(Number(event.target.value)); setBounds(null); setRangeError(null); }
            }} className="mt-2 w-full rounded border border-[#314254] bg-[#0c1722] p-2 text-[#c6d7e4]">
              <option value="15">Latest 15 minutes</option><option value="60">Latest 1 hour</option><option value="480">Latest 8 hours</option>
              {bounds && <option value="custom">Custom range</option>}
            </select>
          </label>
          <details className="mt-4 text-xs text-[#8296a8]"><summary className="cursor-pointer">Custom time range</summary>
            <form className="mt-2 space-y-2" onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const start = new Date(String(form.get("start"))), end = new Date(String(form.get("end")));
              if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { setRangeError("End must be after start."); return; }
              setBounds({ start: start.toISOString(), end: end.toISOString() }); setRangeError(null);
            }}>
              <label className="block">Start (local time)<input name="start" type="datetime-local" required className="mt-1 w-full rounded bg-[#0c1722] p-1" /></label>
              <label className="block">End (local time)<input name="end" type="datetime-local" required className="mt-1 w-full rounded bg-[#0c1722] p-1" /></label>
              <button className="rounded border border-[#314254] px-3 py-1.5" type="submit">Apply range</button>
            </form>
            {rangeError && <p role="alert" className="mt-2 text-amber-400">{rangeError}</p>}
          </details>
          <p className="mt-4 text-[10px] text-[#70889c]">Controller compensation history · mm · refreshes every 5 seconds</p>
          {history.data && <p className="mt-2 text-[10px] text-[#70889c]">{history.data.machine_id} · {history.data.environment}</p>}
        </Panel>
        </ResizableToolBlock>
        <div className="hidden h-full lg:flex"><ColResizeHandle locked={locked} onDrag={(dx) => resizeColumns("tools", dx)} /></div>

        <div ref={gridRef} className="grid min-w-0 items-start gap-y-2" style={{ gridTemplateColumns: `minmax(0, ${columns.diameter}fr) 8px minmax(0, ${100 - columns.diameter}fr)` } as CSSProperties}>
          {METRICS.map((metric) => {
            const values = controllerOffset(controller, metric.key === "diameter" ? "x" : "z");

            return <div key={metric.key} className="contents"><ResizableToolBlock id={`${metric.key}-health`} width={320} height={190} locked={locked} fillWidth><section aria-label={`${metric.label} health`} className="h-full overflow-auto rounded-xl border border-[#2b4052] bg-[#101e2b] p-4">
              <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: metric.color }}>{metric.label}</h3><span className="text-[10px] uppercase text-[#8296a8]">{values.wear !== null ? "Controller" : "No data"}</span></div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2"><p className="text-4xl font-semibold tabular-nums">{values.wear?.toFixed(3) ?? "—"}<span className="ml-2 text-sm font-normal text-[#70889c]">mm</span></p>
              <div className="flex flex-col gap-1 text-[11px] tabular-nums text-[#8296a8]"><span>Geometry {values.geometry?.toFixed(3) ?? "—"} mm</span><span>Offset {values.offset?.toFixed(3) ?? "—"} mm</span></div></div>

              <p className="mt-2 text-[10px] text-[#8296a8]">{`${metric.key === "diameter" ? "xWearMm" : "zWearMm"} · controller ${controllerStatus} · Offset = geometry + wear`}</p>
            </section></ResizableToolBlock>{metric.key === 'diameter' && <div className="flex self-stretch"><ColResizeHandle locked={locked} onDrag={(dx) => resizeColumns("diameter", dx)} /></div>}</div>;
          })}
          {METRICS.map((metric) => <div key={metric.key} className="contents"><ResizableToolBlock id={`${metric.key}-trend`} width={520} height={330} locked={locked} fillWidth>
            <Panel title={`${metric.label} history`} bodyClassName="flex flex-col">
              {history.loading ? <p className="p-4 text-xs text-[#8296a8]">Loading wear history…</p> : null}
              {history.error && <p role="alert" className="mb-2 text-xs text-amber-400">{history.error}{history.data ? " · Showing last successful data" : ""}</p>}
              {history.data && <><div className="relative min-h-[100px] flex-1"><WearHistoryChart history={history.data} axis={metric.axis} label={metric.label} color={metric.color} /></div>
                <p className="mt-2 shrink-0 text-[10px] text-[#70889c]">{history.data.totalPoints} records{history.data.downsampled ? ` · ${history.data.data.length} plotted (extrema preserved)` : ""} · controller compensation
                  {history.data.end ? ` · Through ${new Date(history.data.end).toLocaleString()}` : ""}</p></>}
            </Panel>
          </ResizableToolBlock>{metric.key === 'diameter' && <div className="flex self-stretch"><ColResizeHandle locked={locked} onDrag={(dx) => resizeColumns("diameter", dx)} /></div>}</div>)}
          <div className="col-span-3 min-w-0"><ResizableToolBlock id="photo" width={520} height={380} locked={locked} fillWidth>
          <ToolImageBlock />
          </ResizableToolBlock></div>
        </div>
      </div>

    </div>
  );
}

