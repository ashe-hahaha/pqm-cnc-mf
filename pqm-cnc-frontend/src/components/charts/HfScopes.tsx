"use client";

import { useState } from "react";
import { SensorScope, useSensorClock } from "@/components/charts/SensorScope";
import { buildHfBatch } from "@/lib/hfSensors";

/** Live 4-channel scope (vibration X/Y/Z + acoustic), PdM-style broadband noise + spikes. */
export function HfScopes({
  seed,
  amp,
  caption,
  columns = 1,
  singleChannel = false,
}: {
  seed: number;
  amp: { vibP2pV: number; acousticP2pV: number; spikeRate?: number };
  /** Right-aligned readout next to the title, e.g. RMS values. */
  caption?: string;
  /** Scope columns (use 2 only when the container is wide). */
  columns?: 1 | 2;
  /** Display one channel at a time with a channel picker. */
  singleChannel?: boolean;
}) {
  const [selectedChannel, setSelectedChannel] = useState("Vibration · X");
  const now = useSensorClock();
  const batch = now === 0 ? null : buildHfBatch(now, seed, amp);
  const channels = [
    ["Vibration · X", batch?.vibX ?? []],
    ["Vibration · Y", batch?.vibY ?? []],
    ["Vibration · Z", batch?.vibZ ?? []],
    ["Acoustic", batch?.acoustic ?? []],
  ] as const;
  const visibleChannels = singleChannel
    ? channels.filter(([label]) => label === selectedChannel)
    : channels;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.1em] text-[#8fa3b5]">
          Vibration &amp; acoustic · live scope
        </p>
        {caption ? (
          <p className="text-[10px] tabular-nums text-[#8fa3b5]">{caption}</p>
        ) : null}
      </div>
      {singleChannel && (
        <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[#8fa3b5]">
          Raw signal
          <select aria-label="Raw signal channel" value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} className="min-w-0 rounded border border-[#314254] bg-[#0c1722] px-2 py-1 text-[11px] text-[#c6d7e4]">
            {channels.map(([label]) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
      )}
      <div className={`mt-2 grid gap-2 ${!singleChannel && columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
        {visibleChannels.map(([label, samples]) => (
          <div key={label}>
            <p className="mb-0.5 text-[10px] text-[#8fa3b5]">{label}</p>
            <SensorScope samples={[...samples]} label={label} />
          </div>
        ))}
      </div>
    </div>
  );
}
