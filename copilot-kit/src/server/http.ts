import { NDJSON_CONTENT_TYPE, type ChatTurn } from "../protocol.js";

/** Wrap an event generator as a streaming NDJSON `Response`. */
export function ndjsonResponse(events: AsyncIterable<unknown>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of events) {
          controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": NDJSON_CONTENT_TYPE, "Cache-Control": "no-store" },
  });
}

export type CopilotRequestBody<C> = { message: string; context?: C; history: ChatTurn[] };

/** Parse `{message, context?, history?}`; returns an error `Response` when invalid. */
export async function parseCopilotRequest<C = unknown>(
  req: Request,
): Promise<CopilotRequestBody<C> | Response> {
  let body: { message?: unknown; context?: C; history?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return Response.json({ error: "message required" }, { status: 400 });
  return {
    message,
    context: body.context,
    history: Array.isArray(body.history) ? (body.history as ChatTurn[]) : [],
  };
}

export type SttHandlerOptions = {
  /** Vocabulary hint for Whisper (machine names, codes, jargon). Called per request. */
  vocabulary?: () => string;
  /** Whisper sidecar URL. Default: env STT_URL or http://127.0.0.1:8765 */
  sttUrl?: string;
  maxBytes?: number;
};

/** Route handler: POST multipart {audio} -> {text}, transcribed by the local Whisper sidecar. */
export function createSttHandler(opts: SttHandlerOptions = {}) {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  return async function POST(req: Request): Promise<Response> {
    const sttUrl =
      opts.sttUrl ??
      (typeof process !== "undefined" ? process.env.STT_URL : undefined) ??
      "http://127.0.0.1:8765";
    let audio: File;
    try {
      const f = (await req.formData()).get("audio");
      if (!(f instanceof File) || f.size === 0) {
        return Response.json({ error: "audio required" }, { status: 400 });
      }
      audio = f;
    } catch {
      return Response.json({ error: "Invalid form data" }, { status: 400 });
    }
    if (audio.size > maxBytes) return Response.json({ error: "audio too large" }, { status: 413 });

    const out = new FormData();
    out.set("file", audio, "speech.webm");
    out.set("prompt", opts.vocabulary?.() ?? "");
    try {
      const res = await fetch(`${sttUrl}/transcribe`, {
        method: "POST",
        body: out,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        return Response.json(
          { error: "Could not transcribe that audio" },
          { status: res.status === 413 ? 413 : 422 },
        );
      }
      const j = (await res.json()) as { text?: string };
      return Response.json({ text: (j.text ?? "").trim() });
    } catch {
      return Response.json({ error: "Speech service unavailable" }, { status: 503 });
    }
  };
}

export type TtsHandlerOptions = { sttUrl?: string; maxChars?: number };

/** Route handler: POST {text} -> audio/wav, synthesised by the local Piper voice in the sidecar. */
export function createTtsHandler(opts: TtsHandlerOptions = {}) {
  const maxChars = opts.maxChars ?? 600;
  return async function POST(req: Request): Promise<Response> {
    const url =
      opts.sttUrl ??
      (typeof process !== "undefined" ? process.env.STT_URL : undefined) ??
      "http://127.0.0.1:8765";
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, maxChars) : "";
    if (!text) return Response.json({ error: "text required" }, { status: 400 });
    try {
      const res = await fetch(`${url}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return Response.json({ error: "Speech output unavailable" }, { status: 503 });
      return new Response(await res.arrayBuffer(), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Speech service unavailable" }, { status: 503 });
    }
  };
}
