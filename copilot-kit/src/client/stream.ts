import type { CopilotAction, StreamEvent } from "../protocol.js";

export type StreamHandlers = {
  onToken?: (text: string, fullText: string) => void;
  onStatus?: (text: string) => void;
  onDone?: (done: { actions: CopilotAction[]; chips: string[]; source: "llm" | "scripted"; text: string }) => void;
};

/** Display clean-up for model wording: no "remaining useful life (RUL)" spelled-out-then-abbreviated repetition. */
export function tidyReply(text: string): string {
  return text.replace(/remaining useful life\s*\(RUL\)/gi, "RUL");
}

/**
 * Read the copilot NDJSON stream. Resolves with the full text once the stream
 * ends; throws if the response has no body or was not OK.
 */
export async function readCopilotStream(res: Response, h: StreamHandlers = {}): Promise<string> {
  if (!res.ok || !res.body) throw new Error("Copilot request failed");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent;
      if (ev.type === "token") {
        text += ev.text;
        h.onToken?.(ev.text, tidyReply(text));
      } else if (ev.type === "status") {
        h.onStatus?.(ev.text);
      } else {
        h.onDone?.({ actions: ev.actions, chips: ev.chips, source: ev.source, text: tidyReply(text) });
      }
    }
  }
  return tidyReply(text);
}
