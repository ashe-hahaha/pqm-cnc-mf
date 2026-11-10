import { hash01 } from "@/lib/prng";

/** Same acquisition model as the PdM app (vib XYZ + acoustic, 10 kHz ADC). */
export const SENSOR_POLL_MS = 250;
export const SENSOR_WINDOW_MS = 100;
export const SENSOR_SAMPLE_RATE_HZ = 10_000;
export const SENSOR_SCOPE_Y_MIN = -5;
export const SENSOR_SCOPE_Y_MAX = 5;
/** Nominal bias of the analog front-end (volts). */
export const SENSOR_BIAS_V = 2.5;

export interface SensorSample {
  /** Epoch milliseconds. */
  t: number;
  /** Signal volts (biased ~2.5 V). */
  v: number;
}

export interface HighFrequencySensorBatch {
  vibX: SensorSample[];
  vibY: SensorSample[];
  vibZ: SensorSample[];
  acoustic: SensorSample[];
}

/**
 * Realtime ADC window @ 10 kHz: random broadband noise (no sinusoid), biased
 * ~2.5 V, with sparse spikes at 1.5–2× the normal peak-to-peak.
 */
export function hfChannelVolts(
  endMs: number,
  seed: number,
  /** Normal (non-spike) peak-to-peak amplitude in volts. */
  normalP2pV: number,
  /** Probability per sample that a spike burst starts. */
  spikeRate = 0.014,
): SensorSample[] {
  const n = Math.max(64, Math.round((SENSOR_SAMPLE_RATE_HZ * SENSOR_WINDOW_MS) / 1000));
  const dt = 1000 / SENSOR_SAMPLE_RATE_HZ;
  const startMs = endMs - (n - 1) * dt;
  const half = Math.max(0.05, normalP2pV / 2);
  const samples: SensorSample[] = [];

  let spikeRemain = 0;
  let spikeAmp = 0;

  for (let i = 0; i < n; i++) {
    const tMs = startMs + i * dt;
    const r0 = hash01(seed * 91.3, i);
    const r1 = hash01(seed * 17.1 + 0.4, i + 7919);
    const r2 = hash01(seed * 5.9 + 1.1, i + 15485863);

    let ac: number;
    if (spikeRemain > 0) {
      ac = spikeAmp * (0.65 + 0.7 * (r0 - 0.5));
      spikeRemain -= 1;
    } else if (r1 < spikeRate) {
      const mult = 1.5 + r2 * 0.5;
      spikeAmp = (r0 < 0.5 ? -1 : 1) * half * mult;
      ac = spikeAmp;
      spikeRemain = 1 + Math.floor(hash01(seed, i + 104729) * 4);
    } else {
      ac = (r0 - 0.5) * normalP2pV;
      if (r2 < 0.08) ac *= 0.35 + r1;
    }

    const v = Math.min(SENSOR_SCOPE_Y_MAX, Math.max(SENSOR_SCOPE_Y_MIN, SENSOR_BIAS_V + ac));
    samples.push({
      t: Math.round(tMs * 1000) / 1000,
      v: Math.round(v * 10000) / 10000,
    });
  }
  return samples;
}

/** Build one acquisition window for the four channels, ending at `now`. */
export function buildHfBatch(
  now: number,
  seed: number,
  amp: { vibP2pV: number; acousticP2pV: number; spikeRate?: number },
): HighFrequencySensorBatch {
  const s = seed + now * 0.001;
  return {
    vibX: hfChannelVolts(now, s, amp.vibP2pV, amp.spikeRate),
    vibY: hfChannelVolts(now, s + 11.3, amp.vibP2pV * 0.95, amp.spikeRate),
    vibZ: hfChannelVolts(now, s + 23.7, amp.vibP2pV * 1.05, amp.spikeRate),
    acoustic: hfChannelVolts(now, s + 41.2, amp.acousticP2pV * 0.85, amp.spikeRate),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Process-context readouts → scope amplitudes.
 * `vibrationRms` in mm/s, `acousticRms` in dB (dashboard); heavier cuts and
 * rising risk give larger swings and more spikes, as in the PdM cutting settings.
 */
export function ampFromProcessContext(ctx: { vibrationRms: number; acousticRms: number }) {
  return {
    vibP2pV: clamp(0.35 + ctx.vibrationRms * 0.55, 0.3, 2.2),
    acousticP2pV: clamp(0.6 + (ctx.acousticRms - 48) * 0.055, 0.3, 2.2),
    spikeRate: clamp(0.008 + (ctx.vibrationRms - 1) * 0.006, 0.008, 0.03),
  };
}

/** HMI machine signals (small unitless RMS values) → scope amplitudes. */
export function ampFromMachineSignals(sig: { vibrationRms: number; acousticRms: number }) {
  return {
    vibP2pV: clamp(0.4 + sig.vibrationRms * 1.6, 0.3, 2.2),
    acousticP2pV: clamp(0.4 + sig.acousticRms * 1.6, 0.3, 2.2),
    spikeRate: clamp(0.008 + sig.vibrationRms * 0.012, 0.008, 0.03),
  };
}
