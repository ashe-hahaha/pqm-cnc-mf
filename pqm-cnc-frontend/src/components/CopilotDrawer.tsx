"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotLiveStore } from "@/components/copilot/CopilotContext";
import { DEFAULT_CHIPS } from "@/lib/copilot/tools";
import { cn } from "@/lib/format";
import {
  SpokenSummary,
  readCopilotStream,
  speak,
  speechSupported,
  stopSpeaking,
  useVoiceInput,
  SpeakerPicker,
  getSpeakPref,
  saveSpeakPref,
} from "copilot-kit/client";

type Action = { label: string; href: string };

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: Action[];
  chips?: string[];
  status?: string;
};

function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[#e8eef4]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const STARTER_CHIPS = DEFAULT_CHIPS;

export function CopilotDrawer() {
  const { getContext } = useCopilotLiveStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(getSpeakPref);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "PQM Copilot — ask about balloon risk, quality overview, trends, recommendations, or the machining sim. Answers use live ops data and deep-link the dashboard.",
      chips: STARTER_CHIPS,
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [open, messages, loading]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ask = useCallback(
    async (text: string, opts?: { speak?: boolean }) => {
      const q = text.trim();
      if (!q || loading) return;
      stopSpeaking();
      const readAloud = (opts?.speak || speakReplies) && speechSupported();
      const sentences = new SpokenSummary();
      setInput("");
      const userMsg: ChatMsg = {
        id: `u-${Date.now()}`,
        role: "user",
        text: q,
      };
      setMessages((m) => [...m, userMsg]);
      setLoading(true);
      const id = `a-${Date.now()}`;
      let started = false;
      const patch = (p: Partial<ChatMsg>) =>
        setMessages((m) => {
          if (!started) {
            started = true;
            return [...m, { id, role: "assistant", text: "", ...p }];
          }
          return m.map((x) => (x.id === id ? { ...x, ...p } : x));
        });
      try {
        const history = messages
          .filter((x) => x.id !== "welcome")
          .map((x) => ({ role: x.role, text: x.text }));
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: q, context: getContext(), history }),
        });
        await readCopilotStream(res, {
          onToken: (t, text) => {
            patch({ text, status: undefined });
            if (readAloud) sentences.push(t).forEach(speak);
          },
          onStatus: (status) => patch({ status }),
          onDone: ({ text, actions, chips }) => {
            if (readAloud) sentences.flush().forEach(speak);
            patch({
              text,
              status: undefined,
              actions,
              chips: chips?.length ? chips : STARTER_CHIPS,
            });
          },
        });
        if (!started) throw new Error("empty reply");
      } catch {
        if (started) {
          patch({ chips: STARTER_CHIPS });
        } else {
          patch({
            text: "Something went wrong reaching the copilot. Try again in a moment.",
            chips: STARTER_CHIPS,
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, getContext, messages, speakReplies],
  );

  const voice = useVoiceInput(
    useCallback((t: string) => void ask(t, { speak: true }), [ask]),
  );

  useEffect(() => {
    if (!open) stopSpeaking();
  }, [open]);

  // Hold to talk; a quick tap starts recording and the next tap stops it.
  const micDown = () => {
    if (voice.state === "recording") voice.stop();
    else if (voice.state === "idle" && !loading) {
      stopSpeaking();
      void voice.start();
    }
  };
  const micUp = () => {
    if (
      voice.state === "recording" &&
      Date.now() - voice.startedAt.current > 700
    ) {
      voice.stop();
    }
  };
  const micTitle = !voice.supported
    ? voice.secure
      ? "Microphone not supported in this browser"
      : "Microphone needs HTTPS (or localhost)"
    : "Hold to talk, or tap to start / stop";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open PQM Copilot (C)"
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-11 items-center gap-2 rounded-full border border-[#3d8fd1]/40 bg-[#1a2836] px-3.5 text-sm font-medium text-[#7eb6e8] shadow-lg shadow-black/40 transition hover:border-[#3d8fd1]/70 hover:bg-[#203040]",
          open && "pointer-events-none opacity-0",
        )}
        aria-label="Open PQM Copilot"
      >
        <span className="inline-flex h-2 w-2 rounded-full bg-[#7eb6e8]" />
        Copilot
        <span className="text-[10px] text-[#6b7c8f]">C</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/45 p-3 sm:p-5"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label="PQM Copilot"
            className="flex h-[min(640px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#243141] bg-[#0b111b] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[#243141] px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-[#6b7c8f]">
                  Local AI · live ops data
                </p>
                <h2 className="font-display text-lg text-foreground">
                  PQM Copilot
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {speechSupported() ? (
                  <button
                    type="button"
                    aria-pressed={speakReplies}
                    title="Read replies aloud"
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      speakReplies
                        ? "border-[#3d8fd1]/60 text-[#7eb6e8]"
                        : "border-[#243141] text-[#8fa3b5] hover:border-[#3d8fd1]/40",
                    )}
                    onClick={() => {
                      if (speakReplies) stopSpeaking();
                      setSpeakReplies((v) => { saveSpeakPref(!v); return !v; });
                    }}
                  >
                    {speakReplies ? "Voice on" : "Voice off"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-[#243141] px-2 py-1 text-xs text-[#8fa3b5] hover:border-[#3d8fd1]/40 hover:text-[#7eb6e8]"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "max-w-[95%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "ml-auto bg-[#1a2836] text-[#e8eef4]"
                      : "mr-auto border border-[#243141] bg-[#121a24] text-[#c5d4e3]",
                  )}
                >
                  <div className="whitespace-pre-wrap">
                    {msg.text.split("\n").map((line, i) => (
                      <p key={i} className={i > 0 ? "mt-2" : undefined}>
                        {renderBold(line)}
                      </p>
                    ))}
                  </div>
                  {msg.actions && msg.actions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.actions.map((a) => (
                        <Link
                          key={`${msg.id}-${a.href}-${a.label}`}
                          href={a.href}
                          onClick={() => setOpen(false)}
                          className="rounded-md border border-[#3d8fd1]/40 bg-[#3d8fd1]/10 px-2 py-1 text-[11px] text-[#7eb6e8] hover:bg-[#3d8fd1]/20"
                        >
                          {a.label} →
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {msg.role === "assistant" &&
                  msg.chips &&
                  msg.chips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.chips.map((c) => (
                        <button
                          key={`${msg.id}-${c}`}
                          type="button"
                          disabled={loading}
                          onClick={() => void ask(c)}
                          className="rounded-full border border-[#243141] px-2 py-0.5 text-[11px] text-[#8fa3b5] hover:border-[#3d8fd1]/40 hover:text-[#7eb6e8] disabled:opacity-50"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {loading ? (
                <p className="text-xs text-[#6b7c8f]">
                  {messages.at(-1)?.status ?? "Checking live ops data…"}
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <form
              className="border-t border-[#243141] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <SpeakerPicker />
              {voice.supported && voice.devices.length > 0 ? (
                <div className="mb-2 flex items-center gap-2">
                  <select
                    aria-label="Microphone"
                    value={voice.deviceId}
                    onChange={(e) => voice.setDeviceId(e.target.value)}
                    disabled={voice.state !== "idle"}
                    className="min-w-0 flex-1 truncate rounded-md border border-[#243141] bg-[#0a1219] px-2 py-1 text-xs text-[#8fa3b5] focus:border-[#3d8fd1]/50 focus:outline-none"
                  >
                    <option value="">Default microphone</option>
                    {voice.devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <div
                    className="h-2 w-20 shrink-0 overflow-hidden rounded bg-[#16212d]"
                    title="Input level"
                  >
                    <div
                      className="h-full bg-[#3fb27f] transition-[width] duration-75"
                      style={{ width: `${Math.round(voice.level * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {voice.error ? (
                <p role="alert" className="mb-2 text-xs text-[#e0a35a]">
                  {voice.error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  title={micTitle}
                  aria-label="Talk to the copilot"
                  disabled={!voice.supported || voice.state === "transcribing"}
                  onPointerDown={micDown}
                  onPointerUp={micUp}
                  className={cn(
                    "w-16 rounded-lg border px-2 py-2 text-xs font-medium touch-none select-none disabled:opacity-40",
                    voice.state === "recording"
                      ? "animate-pulse border-[#e05a5a] bg-[#3a1a1a] text-[#ff9b9b]"
                      : "border-[#243141] text-[#8fa3b5] hover:border-[#3d8fd1]/40 hover:text-[#7eb6e8]",
                  )}
                >
                  {voice.state === "recording"
                    ? "● Rec"
                    : voice.state === "transcribing"
                      ? "…"
                      : "🎤"}
                </button>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about balloons, risk, trends…"
                  className="flex-1 rounded-lg border border-[#243141] bg-[#0a1219] px-3 py-2 text-sm text-foreground placeholder:text-[#5a6b7a] focus:border-[#3d8fd1]/50 focus:outline-none"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="rounded-lg bg-[#3d8fd1] px-3 py-2 text-sm font-medium text-[#0b111b] disabled:opacity-40"
                >
                  Ask
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
