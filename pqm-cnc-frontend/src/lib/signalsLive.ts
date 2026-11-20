"use client";
import { useSyncExternalStore } from "react";
import type { ControllerRow } from "./useControllerData";

/**
 * One shared WebSocket to the backend's `/api/signals/ws` for everything on the dashboard that shows machine signals
 * (the four waveform scopes and the controller readouts). The backend sends a `snapshot` (the whole trailing window),
 * then `delta` frames with only the new or changed points and process rows, `status` and a 15 s `ping`.
 */

export const SIGNAL_CHANNELS = ["spindle.vibration_x", "spindle.vibration_y", "spindle.vibration_z", "ae.rms"] as const;
export type SignalChannel = (typeof SIGNAL_CHANNELS)[number];
/** One M4 bucket: `t` is its start (epoch ms). */
export type SignalPoint = { t: number; min: number; max: number; first: number; last: number };
export type SignalSeries = { bucketMs: number; points: SignalPoint[] };
export type SignalsState = {
  /** connecting | live | stale | empty | unavailable | reconnecting | paused (the backend's states plus the connection's own) */
  status: string;
  machineId: string | null;
  /** The window the backend last reported (epoch ms); 0 before the first frame. */
  start: number;
  end: number;
  tMax: number;
  /** `performance.now()` when the last data frame arrived, to keep scrolling smoothly between frames. */
  receivedAt: number;
  series: Record<SignalChannel, SignalSeries>;
  /** Controller rows of the window, oldest first. */
  process: ControllerRow[];
};

type WirePoint = { t: string; min: number; max: number; first: number; last: number };
type WireStatus = { state?: string };
export type WireFrame =
  | { type: "snapshot" | "delta"; machine_id: string; start: string; end: string; t_max: string;
      channels: { channel: string; bucket_ms: number; points: WirePoint[] }[]; process: ControllerRow[]; status?: WireStatus }
  | ({ type: "status" } & WireStatus)
  | { type: "ping" };

export function initialSignalsState(status = "connecting"): SignalsState {
  const empty = (): SignalSeries => ({ bucketMs: 10, points: [] });
  return {
    status, machineId: null, start: 0, end: 0, tMax: 0, receivedAt: 0,
    series: { "spindle.vibration_x": empty(), "spindle.vibration_y": empty(), "spindle.vibration_z": empty(), "ae.rms": empty() },
    process: [],
  };
}

const rowKey = (row: ControllerRow) => String(row.fanuc_raw_id ?? row.timestamp);
const byTime = (a: ControllerRow, b: ControllerRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp);

/** Apply one backend frame. `rows` are the controller rows the frame carried (all of them for a snapshot). */
export function applyFrame(state: SignalsState, frame: WireFrame, receivedAt: number): { state: SignalsState; rows: ControllerRow[] } {
  if (frame.type === "ping") return { state, rows: [] };
  if (frame.type === "status") return { state: frame.state ? { ...state, status: frame.state } : state, rows: [] };
  const snapshot = frame.type === "snapshot";
  const start = Date.parse(frame.start), end = Date.parse(frame.end), tMax = Date.parse(frame.t_max);
  const series = { ...state.series };
  for (const wire of frame.channels) {
    const channel = wire.channel as SignalChannel;
    if (!SIGNAL_CHANNELS.includes(channel)) continue;
    const incoming = wire.points.map(p => ({ t: Date.parse(p.t), min: p.min, max: p.max, first: p.first, last: p.last }));
    let points = incoming;
    if (!snapshot && state.series[channel].bucketMs === wire.bucket_ms) {
      const merged = new Map(state.series[channel].points.map(p => [p.t, p]));
      for (const p of incoming) merged.set(p.t, p);  // a revised bucket replaces the old one in place
      points = [...merged.values()].sort((a, b) => a.t - b.t);
    }
    series[channel] = { bucketMs: wire.bucket_ms, points: Number.isFinite(start) ? points.filter(p => p.t + wire.bucket_ms > start) : points };
  }
  const rows = [...(frame.process ?? [])].sort(byTime);
  let process = rows;
  if (!snapshot) {
    const merged = new Map(state.process.map(row => [rowKey(row), row]));
    for (const row of rows) merged.set(rowKey(row), row);
    process = [...merged.values()].sort(byTime);
  }
  if (Number.isFinite(start)) process = process.filter(row => Date.parse(row.timestamp) >= start);
  return {
    state: { status: frame.status?.state ?? state.status, machineId: frame.machine_id, start, end, tMax, receivedAt, series, process },
    rows,
  };
}

/** `NEXT_PUBLIC_DATA_API_URL` (absolute, or a path such as `/backend` behind the frontend proxy) → the signals WebSocket URL. */
export function signalsWsUrl(base: string, machine: string | undefined, pageUrl: string): string {
  const url = new URL(base.replace(/\/$/, ""), pageUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/signals/ws`;
  url.search = machine ? `?machine_id=${encodeURIComponent(machine)}` : "";
  return url.toString();
}

type Listener = () => void;
type RowListener = (rows: ControllerRow[], receivedAt: string, machine: string) => void;
const STOP_GRACE_MS = 2000;  // survives a React strict-mode remount or a quick route change without reconnecting
const WATCHDOG_MS = 3000;
const SILENCE_MS = 30000;  // the backend pings every 15 s

class SignalsStore {
  private state = initialSignalsState();
  private listeners = new Set<Listener>();
  private rowListeners = new Set<RowListener>();
  private socket: WebSocket | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastFrame = 0;
  private running = false;

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    clearTimeout(this.stopTimer);
    if (!this.running) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopTimer = setTimeout(() => this.stop(), STOP_GRACE_MS);
    };
  };

  /** Rows of every frame (all rows of a snapshot, then only the new or changed ones). */
  subscribeRows = (listener: RowListener) => {
    this.rowListeners.add(listener);
    return () => { this.rowListeners.delete(listener); };
  };

  private set(next: SignalsState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private start() {
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.watchdog = setInterval(() => {
      if (this.socket && Date.now() - this.lastFrame > SILENCE_MS) this.socket.close();  // reconnects via onclose
    }, WATCHDOG_MS);
    this.connect();
  }

  private stop() {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    clearInterval(this.watchdog);
    clearTimeout(this.retryTimer);
    this.close();
    this.state = initialSignalsState();
  }

  private close() {
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.close(); }
  }

  private onVisibility = () => {
    if (!this.running) return;
    if (document.hidden) {
      clearTimeout(this.retryTimer);
      this.close();
      this.set({ ...this.state, status: "paused" });
    } else if (!this.socket) {
      this.connect();
    }
  };

  private connect() {
    if (!this.running || this.socket || document.hidden) return;
    const base = process.env.NEXT_PUBLIC_DATA_API_URL ?? "http://127.0.0.1:8000";
    const socket = new WebSocket(signalsWsUrl(base, process.env.NEXT_PUBLIC_SIGNALS_MACHINE_ID, window.location.href));
    this.socket = socket;
    this.lastFrame = Date.now();
    if (this.state.status !== "live") this.set({ ...this.state, status: this.state.start ? "reconnecting" : "connecting" });
    socket.onopen = () => { this.retries = 0; };
    socket.onmessage = event => {
      this.lastFrame = Date.now();
      let frame: WireFrame;
      try { frame = JSON.parse(String(event.data)) as WireFrame; } catch { return; }
      const { state, rows } = applyFrame(this.state, frame, performance.now());
      if (state !== this.state) this.set(state);
      if (rows.length) {
        const receivedAt = new Date().toISOString();
        for (const listener of this.rowListeners) listener(rows, receivedAt, state.machineId ?? "");
      }
    };
    socket.onclose = () => {
      this.socket = null;
      if (!this.running || document.hidden) return;
      this.set({ ...this.state, status: this.state.start ? "reconnecting" : "unavailable" });
      this.retryTimer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retries++));
    };
    socket.onerror = () => { /* onclose follows and reconnects */ };
  }
}

export const signalsStore = new SignalsStore();
const serverState = initialSignalsState();

/** The live signals; the component re-renders on every frame (about twice a second). */
export function useSignalsLive(): SignalsState {
  return useSyncExternalStore(signalsStore.subscribe, signalsStore.getSnapshot, () => serverState);
}
