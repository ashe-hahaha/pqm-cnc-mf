"use client";

import { useEffect, useState } from "react";
import { useToolImage } from "@/lib/useToolImage";
import { Panel } from "./Panel";

const statusLabels: Record<string, string> = {
  connecting: "Connecting…", connected: "Waiting for new captures", disabled: "Kafka receiver disabled",
  unavailable: "Image source unavailable · retrying", reconnecting: "Connection lost · reconnecting",
};

/** Latest received capture, independent of the selected tool and camera timestamp order. */
export function ToolImageBlock() {
  const { image, status } = useToolImage();
  const [expanded, setExpanded] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = image ? `${image.machineId} · Tool ${image.toolNo}` : "Tool wear";
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  const failed = image?.imageUrl === failedUrl;
  return <>
    <Panel title="Tool condition photo" titleRight={<span role="status" className="text-[10px] text-[#8296a8]">{statusLabels[status] ?? status}</span>}>
      <div className="flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#385064] bg-[#0a141e]">
        {image && !failed ? <button className="h-full w-full" onClick={() => setExpanded(true)} aria-label="Enlarge tool condition photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.imageUrl} alt={`${label} microscope capture`} className="max-h-[230px] w-full object-contain" onError={() => setFailedUrl(image.imageUrl)} />
        </button> : <div className="p-6 text-center"><span className="text-3xl text-[#6294b3]">▧</span><p className="mt-3 text-sm text-[#bbcfde]">{failed ? "Image could not be loaded" : "Waiting for microscope image…"}</p></div>}
      </div>
      <div className="mt-2 shrink-0 text-[11px] text-[#8296a8]">
        {image ? <><p>{label} · Captured {new Date(image.timestampUtc).toLocaleString()}</p>
          {image.inspectionResult && <p className="mt-1 text-[#bbcfde]">{image.inspectionResult}</p>}
          <p className="mt-1 text-[10px]">Latest received capture · independent of selected tool</p></> : <p>The next valid capture will appear here automatically.</p>}
      </div>
    </Panel>
    {expanded && image && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6" role="dialog" aria-modal="true" aria-label={`${label} inspection photo`} onClick={() => setExpanded(false)}>
      <button autoFocus className="absolute right-6 top-6 rounded-lg border border-[#314254] bg-[#152738] px-3 py-2 text-xs text-[#a6bacb]" onClick={() => setExpanded(false)}>Close photo ×</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.imageUrl} alt={`${label} actual condition enlarged`} className="max-h-[85vh] max-w-full object-contain" />
    </div>}
  </>;
}
