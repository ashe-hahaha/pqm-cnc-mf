import { createElement as h, useEffect, useState } from "react";
import { SERVER_VOICE, getPreferredVoice, listVoices, setPreferredVoice, speechSupported, testSpeaker } from "./speech.js";

const box = { display: "flex", flexDirection: "column" as const, gap: 4, marginBottom: 8 };
const row = { display: "flex", alignItems: "center", gap: 8 };
const sel = { flex: 1, minWidth: 0, borderRadius: 6, border: "1px solid #243141", background: "#0a1219", color: "#8fa3b5", padding: "4px 8px", fontSize: 12 };
const btn = { borderRadius: 6, border: "1px solid #243141", background: "transparent", color: "#8fa3b5", padding: "4px 8px", fontSize: 12, cursor: "pointer" };

/**
 * Voice picker + "Test" button for spoken replies. (Browsers pick the audio output device themselves:
 * speech cannot be routed to a chosen speaker, so the hint tells users where to look when it is silent.)
 */
export function SpeakerPicker() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [uri, setUri] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!speechSupported()) return;
    setUri(getPreferredVoice());
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(listVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  if (!speechSupported()) return null;
  return h(
    "div",
    { style: box },
    h(
      "div",
      { style: row },
      h(
        "select",
        {
          "aria-label": "Speech voice",
          value: uri,
          style: sel,
          onChange: (e: { target: { value: string } }) => {
            setUri(e.target.value);
            setPreferredVoice(e.target.value);
          },
        },
        h("option", { value: "" }, voices.length ? "Voice: automatic" : "Voice: automatic (server voice)"),
        h("option", { value: SERVER_VOICE }, "Server voice (plays through any device)"),
        ...voices.map((v) => h("option", { key: v.voiceURI, value: v.voiceURI }, `${v.name} (${v.lang})${v.localService ? "" : " · online"}`)),
      ),
      h(
        "button",
        {
          type: "button",
          style: btn,
          disabled: busy,
          onClick: async () => {
            setBusy(true);
            const r = await testSpeaker();
            setMsg({ ok: r.ok, text: r.message });
            setBusy(false);
          },
        },
        "Test speaker",
      ),
    ),
    msg ? h("p", { role: "status", style: { margin: 0, fontSize: 11, color: msg.ok ? "#8fa3b5" : "#e0a35a" } }, msg.text) : null,
  );
}
