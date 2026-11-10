# copilot-kit

Shared building blocks for the PdM / OEE / PQM demo apps' **local-LLM copilot**
and **voice** (speech-to-text + text-to-speech). Apps keep their own UI, tools
and data; the kit provides the plumbing.

| Entry point | Contents |
|-------------|----------|
| `copilot-kit/server` | `streamAgent` (Ollama tool-calling loop, `<think>` stripping, scripted fallback), `ndjsonResponse`, `parseCopilotRequest`, `createSttHandler`, protocol types |
| `copilot-kit/client` | `readCopilotStream`, `useVoiceInput` (mic picker, level meter, silence check), `speech` helpers (`SpokenSummary`, `cleanForSpeech`, `speak`, `stopSpeaking`) |
| `stt-service/` | Whisper (faster-whisper) HTTP sidecar + `run_stt.sh` — one instance serves every app |

## Use it in an app

```bash
# .npmrc  (copy, don't symlink: Turbopack won't resolve links outside the project root)
install-links=true
npm install --install-links ../copilot-kit
```

```ts
// src/app/api/copilot/route.ts
import { ndjsonResponse, parseCopilotRequest, streamAgent } from "copilot-kit/server";

export async function POST(req: Request) {
  const parsed = await parseCopilotRequest<MyContext>(req);
  if (parsed instanceof Response) return parsed;
  return ndjsonResponse(streamAgent<MyContext>({
    message: parsed.message, history: parsed.history, context: parsed.context,
    system: "You are the OEE copilot… answer ONLY from tool results.",
    tools: [{ name: "get_dashboard", description: "…", parameters: { properties: { asset: { type: "string" } } },
              run: async (args, ctx) => ({ message: "…grounded text…", actions: [{ label: "Open", href: "/dashboard" }] }) }],
    fallback: (m, ctx) => scriptedReply(m, ctx),   // used when the LLM is down
    chips: (ctx) => ["…"],
    signal: req.signal,
  }));
}

// src/app/api/voice/stt/route.ts
import { createSttHandler } from "copilot-kit/server";
export const POST = createSttHandler({ vocabulary: () => "Machines: …" });
```

Tools may be async (e.g. call a service); return **already-formatted** figures
and let the model only phrase them. Client side: `readCopilotStream(res, handlers)`
to consume the stream and `useVoiceInput(onText)` for the mic.

## Services & config

- LLM: Ollama, env `LLM_BASE_URL` (default `http://localhost:11434`), `LLM_MODEL` (default `qwen3:32b`).
- STT: `stt-service/run_stt.sh` → `127.0.0.1:8765`; env `STT_URL` in the app. Needs a venv in
  `~/pdm-cnc-voice` (faster-whisper, fastapi, uvicorn[standard], python-multipart, `av<17`, NVIDIA cuBLAS/cuDNN wheels).
- Browsers only allow the mic on HTTPS or localhost.

## Develop

```bash
npm test          # agent loop (fake Ollama) + speech helpers
npm run build     # emits dist/ — consumers install the built output
# in an app: re-copy after changes
npm run kit:update
```
