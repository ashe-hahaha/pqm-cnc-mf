"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";
export type MicDevice = { id: string; label: string };

const MAX_RECORD_MS = 30_000;
const MIN_RECORD_MS = 400;
/** Peak amplitude (0..1) below which a recording is treated as silent (~ -40 dBFS). */
const SILENT_PEAK = 0.01;
const DEVICE_KEY = "pdm.micDeviceId";

function micAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

const noopSubscribe = () => () => {};

async function listMics(): Promise<MicDevice[]> {
  if (!micAvailable() || !navigator.mediaDevices.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput" && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/**
 * Record from the microphone and transcribe via /api/voice/stt (local Whisper).
 * `onText` receives the transcript. Needs a secure context (https or localhost).
 */
export function useVoiceInput(onText: (text: string) => void) {
  const supported = useSyncExternalStore(noopSubscribe, micAvailable, () => false);
  const secure = useSyncExternalStore(
    noopSubscribe,
    () => window.isSecureContext,
    () => true,
  );
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceIdState] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(DEVICE_KEY) ?? ""),
  );
  const [level, setLevel] = useState(0);
  const recorder = useRef<MemoryRecorder | null>(null);
  const startedAt = useRef(0);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshDevices = useCallback(
    () => void listMics().then((m) => setDevices(m)),
    [],
  );

  useEffect(() => {
    if (!micAvailable()) return;
    const md = navigator.mediaDevices;
    let live = true;
    void listMics().then((m) => live && setDevices(m));
    const onChange = () => void listMics().then((m) => live && setDevices(m));
    md.addEventListener?.("devicechange", onChange);
    return () => {
      live = false;
      md.removeEventListener?.("devicechange", onChange);
    };
  }, []);

  const setDeviceId = useCallback((id: string) => {
    setDeviceIdState(id);
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  }, []);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.set("audio", blob, "speech.webm");
        const res = await fetch("/api/voice/stt", { method: "POST", body: form });
        const j = (await res.json()) as { text?: string; error?: string };
        if (!res.ok) throw new Error(j.error ?? "Transcription failed");
        if (!j.text) setError("Didn’t catch that — try again.");
        else onText(j.text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setState("idle");
      }
    },
    [onText],
  );

  const stop = useCallback(() => {
    clearTimeout(maxTimer.current);
    recorder.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError("");
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (e) {
        // Saved device unplugged: fall back to the default input.
        if (deviceId && e instanceof DOMException && e.name === "OverconstrainedError") {
          setDeviceId("");
          delete audio.deviceId;
          stream = await navigator.mediaDevices.getUserMedia({ audio });
        } else throw e;
      }
      refreshDevices(); // device labels become available after permission

      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const rec = new MemoryRecorder(stream, mime, setLevel, (blob, peak) => {
        recorder.current = null;
        setLevel(0);
        const tooShort = Date.now() - startedAt.current < MIN_RECORD_MS;
        if (tooShort || blob.size === 0) setState("idle");
        else if (peak < SILENT_PEAK) {
          setState("idle");
          setError(
            "The microphone sounds silent — pick another input below or check its volume / mute.",
          );
        } else void transcribe(blob);
      });
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setState("recording");
      maxTimer.current = setTimeout(stop, MAX_RECORD_MS);
    } catch (e) {
      setState("idle");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access the microphone.",
      );
    }
  }, [state, deviceId, refreshDevices, setDeviceId, stop, transcribe]);

  return {
    supported,
    secure,
    state,
    error,
    start,
    stop,
    startedAt,
    devices,
    deviceId,
    setDeviceId,
    level,
  };
}

/** MediaRecorder + peak/level metering over one stream. */
class MemoryRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private ctx: AudioContext;
  private raf = 0;
  private peak = 0;

  constructor(
    private stream: MediaStream,
    mime: string | undefined,
    onLevel: (l: number) => void,
    onDone: (blob: Blob, peak: number) => void,
  ) {
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let p = 0;
      for (const v of buf) p = Math.max(p, Math.abs(v));
      this.peak = Math.max(this.peak, p);
      onLevel(Math.min(1, p * 3));
      this.raf = requestAnimationFrame(tick);
    };
    tick();

    this.rec.onstop = () => {
      cancelAnimationFrame(this.raf);
      this.stream.getTracks().forEach((t) => t.stop());
      void this.ctx.close();
      onDone(new Blob(this.chunks, { type: this.rec.mimeType }), this.peak);
    };
  }

  start() {
    this.rec.start();
  }

  stop() {
    if (this.rec.state !== "inactive") this.rec.stop();
  }
}
