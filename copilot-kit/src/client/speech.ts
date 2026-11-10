/** Helpers for reading copilot replies aloud (browser speechSynthesis, fully local). */

/** Strip Markdown / symbols and make units and machine codes read naturally. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*|__|`|#+\s?/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[•\-*]\s+/gm, "")
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/(\d+)\s*d\b/g, (_, n: string) => `${n} ${n === "1" ? "day" : "days"}`)
    .replace(/remaining useful life\s*\(RUL\)/gi, "RUL") // avoid "remaining useful life (remaining useful life)"
    .replace(/\bRUL\b/g, "remaining useful life")
    .replace(/\bAE\b/g, "acoustic emission")
    // Read machine codes digit by digit: IC035302 -> "I C 0 3 5 3 0 2"
    .replace(/\b([A-Z]{2,})(\d{3,})\b/g, (_, l: string, d: string) =>
      `${l.split("").join(" ")} ${d.split("").join(" ")}`,
    )
    .replace(/\s*·\s*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const SENTENCE_END = /([.!?:]+(?=\s)|\n+)/;

/**
 * Accumulates streamed text and emits complete sentences, so speech can start
 * before the whole reply has arrived.
 */
export class SentenceBuffer {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    for (;;) {
      const m = SENTENCE_END.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const s = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end);
      if (s) out.push(s);
    }
    return out;
  }

  /** Remaining partial sentence at end of stream. */
  flush(): string[] {
    const s = this.buf.trim();
    this.buf = "";
    return s ? [s] : [];
  }
}

const MAX_SPOKEN_SENTENCES = 2;
const MAX_SPOKEN_CHARS = 260;
const DETAILS_NOTE = "The details are in the chat.";

/**
 * Turns a streamed reply into a short spoken summary: the first sentences
 * only (list items and lead-ins are skipped), then a pointer to the text.
 */
export class SpokenSummary {
  private sentences = new SentenceBuffer();
  private spoken = 0;
  private chars = 0;
  private dropped = false;

  private take(list: string[]): string[] {
    const out: string[] = [];
    for (const s of list) {
      const isListItem = /^\s*[•\-*]\s/.test(s) || /:$/.test(s);
      const len = cleanForSpeech(s).length;
      if (
        isListItem ||
        this.spoken >= MAX_SPOKEN_SENTENCES ||
        (this.spoken > 0 && this.chars + len > MAX_SPOKEN_CHARS)
      ) {
        this.dropped = true;
        continue;
      }
      this.spoken++;
      this.chars += len;
      out.push(s);
    }
    return out;
  }

  push(chunk: string): string[] {
    return this.take(this.sentences.push(chunk));
  }

  /** Call at end of stream; appends the "details in the chat" note if anything was left out. */
  flush(): string[] {
    const out = this.take(this.sentences.flush());
    if (this.dropped) out.push(DETAILS_NOTE);
    return out;
  }
}

const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Spoken output is possible: the browser's own voices, or server audio (Piper) played through an <audio> element. */
export function speechSupported(): boolean {
  return hasSynth() || (typeof window !== "undefined" && typeof Audio !== "undefined");
}

const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

// ── Mobile (Android Chrome) quirks ──────────────────────────────────────────
// 1. speechSynthesis only produces sound after the page has used it inside a user gesture; replies
//    arrive after an async fetch, so the first tap/keypress "unlocks" it with a silent utterance.
// 2. getVoices() is empty until `voiceschanged` fires.
// 3. Utterances that are garbage-collected mid-speech never finish: keep references.
// 4. Network voices fail silently when the connection is weak: prefer local voices, and retry once
//    with the default voice if an utterance errors out.
let unlocked = false;
const alive = new Set<SpeechSynthesisUtterance>();

// ── Server voice ────────────────────────────────────────────────────────────
// Some devices (Android TVs, kiosks) ship without any speech engine, so speechSynthesis has no voices.
// The server synthesises the sentence (Piper, local) and the page just plays the audio.
export const SERVER_VOICE = "server";
const TTS_URL = "/api/voice/tts";
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";
let player: HTMLAudioElement | null = null;
let queue: Promise<void> = Promise.resolve();
let generation = 0;

function audioEl(): HTMLAudioElement {
  return (player ??= new Audio());
}

/** Reuse one element and start it inside a gesture so later playback is allowed. */
function unlockAudio() {
  try {
    const a = audioEl();
    a.src = SILENT_WAV;
    void a.play().catch(() => {});
  } catch {
    /* no audio support */
  }
}

async function fetchSpeech(text: string): Promise<Blob> {
  const res = await fetch(TTS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(res.status === 503 ? "server voice unavailable (is the voice service running?)" : `server voice failed (${res.status})`);
  return res.blob();
}

function playBlob(blob: Blob, gen: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gen !== generation) return resolve();
    const url = URL.createObjectURL(blob);
    const a = audioEl();
    const end = () => {
      a.onended = a.onerror = null;
      URL.revokeObjectURL(url);
    };
    a.onended = () => (end(), resolve());
    a.onerror = () => (end(), reject(new Error("audio playback failed")));
    a.src = url;
    a.play().catch((e) => (end(), reject(e instanceof Error ? e : new Error("audio playback blocked"))));
  });
}

/** Queue a sentence: synthesis starts immediately, playback keeps the order. */
function serverSpeak(text: string): Promise<void> {
  const gen = generation;
  const blob = fetchSpeech(text);
  blob.catch(() => {});
  const run = queue.then(async () => {
    if (gen !== generation) return;
    await playBlob(await blob, gen);
  });
  queue = run.catch(() => {});
  return run;
}

function stopServerSpeech() {
  generation++;
  queue = Promise.resolve();
  if (player) {
    player.pause();
    player.removeAttribute("src");
  }
}

/** Silent utterance inside a user gesture so later (async) replies are allowed to speak. */
export function primeSpeech(): void {
  if (unlocked || !speechSupported()) return;
  unlocked = true;
  unlockAudio();
  if (!hasSynth()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* audio unlock above is enough */
  }
}

if (typeof window !== "undefined") {
  const unlock = () => {
    primeSpeech();
    if (unlocked) for (const ev of ["pointerdown", "touchend", "click", "keydown"]) window.removeEventListener(ev, unlock, true);
  };
  for (const ev of ["pointerdown", "touchend", "click", "keydown"]) window.addEventListener(ev, unlock, true);
  // Warm the voice list (Android loads it lazily).
  if (hasSynth()) window.speechSynthesis.getVoices();
}

const VOICE_KEY = "copilot-kit:voice";

export function getPreferredVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** "" = automatic. */
export function setPreferredVoice(voiceURI: string): void {
  try {
    if (voiceURI) localStorage.setItem(VOICE_KEY, voiceURI);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    /* private mode: keep the automatic choice */
  }
}

/** English voices first, then the rest. */
export function listVoices(): SpeechSynthesisVoice[] {
  if (!hasSynth()) return [];
  const en = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase().startsWith("en");
  return [...window.speechSynthesis.getVoices()].sort((a, b) => Number(en(b)) - Number(en(a)) || a.name.localeCompare(b.name));
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const chosen = getPreferredVoice();
  if (chosen) {
    const v = voices.find((x) => x.voiceURI === chosen);
    if (v) return v;
  }
  const en = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("en"));
  const local = en.filter((v) => v.localService);
  if (isAndroid()) return local.find((v) => /en[-_]us/i.test(v.lang)) ?? local[0] ?? en.find((v) => /en[-_]us/i.test(v.lang)) ?? en[0];
  return (
    en.find((v) => /natural|neural|online/i.test(v.name)) ??
    en.find((v) => v.lang.startsWith("en-") && v.localService) ??
    en[0]
  );
}

function say(text: string, useVoice: boolean): void {
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.volume = 1;
  const v = useVoice ? pickVoice() : undefined;
  if (v) {
    u.voice = v;
    u.lang = v.lang; // a lang that differs from the voice's makes Android stay silent
  } else u.lang = "en-US";
  alive.add(u);
  u.onend = () => alive.delete(u);
  u.onerror = (e) => {
    alive.delete(u);
    if (e.error === "canceled" || e.error === "interrupted") return;
    if (useVoice && v) say(text, false);
    else void serverSpeak(text).catch(() => {});
  };
  if (synth.paused) synth.resume();
  synth.speak(u);
}

export function speak(sentence: string): void {
  if (!speechSupported()) return;
  const clean = cleanForSpeech(sentence);
  if (!clean) return;
  const viaServer = () => void serverSpeak(clean).catch(() => {});
  if (!hasSynth() || getPreferredVoice() === SERVER_VOICE) return viaServer();
  const synth = window.speechSynthesis;
  // Voices may not be loaded yet on a cold page: wait briefly. If the device has none, use the server voice.
  if (synth.getVoices().length === 0) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      synth.removeEventListener("voiceschanged", go);
      if (synth.getVoices().length === 0) viaServer();
      else say(clean, true);
    };
    synth.addEventListener("voiceschanged", go);
    setTimeout(go, 600);
    return;
  }
  say(clean, true);
}

export function stopSpeaking(): void {
  if (!speechSupported()) return;
  stopServerSpeech();
  if (!hasSynth()) return;
  alive.clear();
  window.speechSynthesis.cancel();
}

export type SpeakerTest = { ok: boolean; message: string };

/**
 * Speak a short test phrase and report whether the browser actually started it.
 * (Browsers cannot report whether the sound is audible, so the message reminds the user to check volume.)
 */
export function testSpeaker(): Promise<SpeakerTest> {
  const phrase = "Speaker test. Can you hear this?";
  const viaServer = async (why: string): Promise<SpeakerTest> => {
    try {
      stopServerSpeech();
      await serverSpeak(phrase);
      return { ok: true, message: `${why}Played through the server voice. No sound? Raise the device volume or check its audio output.` };
    } catch (e) {
      return { ok: false, message: `${why}Server voice failed: ${e instanceof Error ? e.message : "unknown error"}.` };
    }
  };
  if (!speechSupported()) return Promise.resolve({ ok: false, message: "This browser cannot play speech." });
  primeSpeech();
  if (!hasSynth() || getPreferredVoice() === SERVER_VOICE) return viaServer("");
  const synth = window.speechSynthesis;
  if (synth.getVoices().length === 0) return viaServer("This device has no speech engine, so the server voice is used. ");
  return new Promise((resolve) => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(phrase);
    const v = pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "en-US";
    u.volume = 1;
    alive.add(u);
    let settled = false;
    const done = (r: SpeakerTest) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, message: "The browser did not start speaking. Choose “Server voice” in the list and test again." }), 4000);
    u.onstart = () => done({ ok: true, message: `Speaking with ${v?.name ?? "the default voice"}. No sound? Raise the media volume, check Bluetooth/earpiece routing, or choose “Server voice”.` });
    u.onend = () => alive.delete(u);
    u.onerror = (e) => {
      alive.delete(u);
      done({ ok: false, message: `Speech failed (${e.error}). Choose “Server voice” and test again.` });
    };
    synth.speak(u);
  });
}

const SPEAK_KEY = "copilot-kit:speak";

/** Read replies aloud? Default on (typed questions and suggestion chips speak too); the user's choice is remembered. */
export function getSpeakPref(): boolean {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(SPEAK_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSpeakPref(on: boolean): void {
  try {
    localStorage.setItem(SPEAK_KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}
