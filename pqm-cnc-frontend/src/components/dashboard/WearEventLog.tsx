"use client";

import { useRef, useState } from "react";
import { toolKey, toolLabel } from "@/lib/toolNumber";

export type WearEvent = {
  id: string;
  timestampUtc: string;
  label: string;
  toolNo: string | number | null;
  detail?: string | null;
};

export function WearEventLog({ events }: { events: readonly WearEvent[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const latest = events.at(-1);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => { dialog.current?.showModal(); setOpen(true); }}
        className="col-span-3 flex w-full items-center justify-between gap-3 rounded border border-[#293b4c] bg-[#101e2b] px-3 py-2 text-left text-[11px] text-[#c6d7e4] hover:bg-[#192a39] focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <span className="min-w-0 truncate">
          {latest ? <><time dateTime={latest.timestampUtc}>{new Date(latest.timestampUtc).toLocaleTimeString()}</time>
            {" · "}{toolLabel(toolKey(latest.toolNo))}{" · "}{latest.label}</> : "No event"}
        </span>
        <span className="shrink-0 text-[#8296a8]">Event history</span>
      </button>
      <dialog ref={dialog} aria-label="Tool wear event history" onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,36rem)] rounded-xl border border-[#314254] bg-[#101e2b] p-4 text-[#c6d7e4] backdrop:bg-black/70">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Tool wear event history</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded border border-[#314254] px-2 py-1 text-xs">Close</button>
        </div>
        {open && (events.length ? (
          <ol className="max-h-[60vh] divide-y divide-[#293b4c] overflow-y-auto text-xs">
            {[...events].reverse().sort((a, b) => Date.parse(b.timestampUtc) - Date.parse(a.timestampUtc)).map(event => (
              <li key={event.id} className="py-2">
                <time dateTime={event.timestampUtc} className="text-[11px] tabular-nums text-[#8296a8]">{new Date(event.timestampUtc).toLocaleString()}</time>
                <p>{toolLabel(toolKey(event.toolNo))} · {event.label}</p>
                {event.detail && <p className="text-[11px] text-[#8296a8]">{event.detail}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-xs text-[#8296a8]">No event</p>)}
      </dialog>
    </>
  );
}
