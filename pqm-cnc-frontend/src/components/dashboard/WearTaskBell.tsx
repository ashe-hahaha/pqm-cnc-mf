"use client";

import { useEffect, useRef, useState } from "react";
import type { WearTask } from "./WearAlertDemo";
import { toolKey, toolLabel } from "@/lib/toolNumber";

export function WearTaskBell({ tasks, onOpen }: { tasks: readonly WearTask[]; onOpen: (task: WearTask) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={ref} className="relative">
    <button type="button" aria-label={`Pending tasks (${tasks.length})`} aria-expanded={open}
      onClick={() => setOpen(p => !p)} className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[#243141] bg-[#121a24] text-sm text-[#8fa3b5]">
      <span aria-hidden>🔔</span>
      {tasks.length > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-1 text-[10px] text-black">{tasks.length}</span>}
    </button>
    {open && <div role="dialog" aria-label="Pending tasks" className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-[min(90vw,360px)] overflow-auto rounded-xl border border-[#314254] bg-[#121a24] p-3 shadow-xl">
      <h2 className="mb-2 text-xs font-semibold text-[#c6d7e4]">Pending tasks</h2>
      {!tasks.length && <p className="text-xs text-[#8fa3b5]">No pending tasks</p>}
      <ul className="space-y-2">{tasks.map(task => <li key={task.id}>
        <button type="button" onClick={() => { setOpen(false); onOpen(task); }} className="w-full rounded border border-[#314254] p-2 text-left text-xs text-[#c6d7e4] hover:bg-[#23425b]">
          <span>{toolLabel(toolKey(task.toolNo))} · {task.kind === "inspection" ? "Confirm laser inspection" : "Confirm rework"}</span>
          <time dateTime={task.timestampUtc} className="mt-1 block text-[10px] text-[#8fa3b5]">{new Date(task.timestampUtc).toLocaleString()}{task.deferred ? " · Deferred" : ""}</time>
        </button>
      </li>)}</ul>
    </div>}
  </div>;
}
