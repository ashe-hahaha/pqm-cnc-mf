/** Wire protocol between the copilot route (server) and the drawer (client): NDJSON events. */

export type CopilotAction = { label: string; href: string };

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  | {
      type: "done";
      actions: CopilotAction[];
      chips: string[];
      /** "llm" when the model answered, "scripted" when the fallback did. */
      source: "llm" | "scripted";
    };

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** What a tool (or the scripted fallback) returns. */
export type ToolResult = { message: string; actions?: CopilotAction[] };

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";
