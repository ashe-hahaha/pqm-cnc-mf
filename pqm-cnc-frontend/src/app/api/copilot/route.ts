import { NextRequest } from "next/server";
import { ndjsonResponse, parseCopilotRequest } from "copilot-kit/server";
import { streamCopilot } from "@/lib/copilot/llm";
import type { CopilotContext } from "@/lib/copilot/tools";

export const dynamic = "force-dynamic";

/** Streams NDJSON events: {type:"token"|"status"|"done", ...}. */
export async function POST(req: NextRequest) {
  const parsed = await parseCopilotRequest<CopilotContext>(req);
  if (parsed instanceof Response) return parsed;
  return ndjsonResponse(
    streamCopilot(parsed.message, parsed.context, parsed.history, req.signal),
  );
}
