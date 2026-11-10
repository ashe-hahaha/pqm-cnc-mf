import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { streamAgent, type AgentTool } from "./agent.js";
import type { StreamEvent } from "../protocol.js";

/** Minimal fake Ollama: replies are scripted per request count. */
let server: http.Server;
let base = "";
let calls: { messages: { role: string; content: string }[] }[] = [];
let script: (n: number) => object[] = () => [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      for (const m of script(calls.length)) res.write(JSON.stringify({ message: m }) + "\n");
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const tool: AgentTool<{ plant: string }> = {
  name: "get_status",
  description: "status",
  run: (args, ctx) => ({
    message: `status of ${String(args.machine)} in ${ctx?.plant}`,
    actions: [{ label: "Open", href: "/m/1" }],
  }),
};

async function collect(
  opts: Partial<Parameters<typeof streamAgent<{ plant: string }>>[0]> = {},
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of streamAgent<{ plant: string }>({
    message: "how is M1?",
    context: { plant: "P" },
    system: "sys",
    tools: [tool],
    fallback: () => ({ message: "scripted answer", actions: [{ label: "Map", href: "/map" }] }),
    chips: () => ["chip"],
    signal: new AbortController().signal,
    llm: { baseUrl: base, model: "m" },
    ...opts,
  })) {
    out.push(e);
  }
  return out;
}

describe("streamAgent", () => {
  it("runs a tool, feeds the result back, and streams the final answer", async () => {
    calls = [];
    script = (n) =>
      n === 1
        ? [{ tool_calls: [{ function: { name: "get_status", arguments: { machine: "M1" } } }] }]
        : [{ content: "All " }, { content: "good." }];
    const ev = await collect();
    expect(ev.filter((e) => e.type === "status")).toHaveLength(1);
    expect(ev.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe(
      "All good.",
    );
    const done = ev.at(-1) as Extract<StreamEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", source: "llm", chips: ["chip"] });
    expect(done.actions).toEqual([{ label: "Open", href: "/m/1" }]);
    // The tool result reached the model on round 2, with the app context.
    const toolMsg = calls[1]!.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("status of M1 in P");
  });

  it("hides <think> blocks", async () => {
    calls = [];
    script = () => [{ content: "<think>hmm" }, { content: " more</think>Answer" }];
    const ev = await collect();
    const text = ev.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
    expect(text).toBe("Answer");
  });

  it("an unknown tool and a throwing tool do not crash the loop", async () => {
    calls = [];
    script = (n) =>
      n === 1
        ? [
            { tool_calls: [{ function: { name: "nope", arguments: {} } }] },
            { tool_calls: [{ function: { name: "boom", arguments: {} } }] },
          ]
        : [{ content: "ok" }];
    const boom: AgentTool = {
      name: "boom",
      description: "x",
      run: () => {
        throw new Error("db down");
      },
    };
    const ev = await collect({ tools: [tool, boom] as never });
    expect(ev.at(-1)).toMatchObject({ type: "done", source: "llm" });
    const toolMsgs = calls[1]!.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolMsgs).toEqual(["Unknown tool.", "Tool failed: db down"]);
  });

  it("caps tool rounds", async () => {
    calls = [];
    script = () => [{ tool_calls: [{ function: { name: "get_status", arguments: {} } }] }];
    await collect({ llm: { baseUrl: base, model: "m", maxRounds: 2 } });
    expect(calls).toHaveLength(2);
  });

  it("falls back to the scripted answer when the LLM is unreachable", async () => {
    const ev = await collect({ llm: { baseUrl: "http://127.0.0.1:1", model: "m" } });
    expect(ev).toEqual([
      { type: "token", text: "scripted answer" },
      { type: "done", actions: [{ label: "Map", href: "/map" }], chips: ["chip"], source: "scripted" },
    ]);
  });
});
