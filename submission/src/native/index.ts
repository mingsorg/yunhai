import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { AccessDenied } from "../policy.ts";
import { authenticateNative, configurationAllows, LOCAL_HOSTS, type AuthEnv } from "./auth.ts";
import { createJudge, fixtureAi } from "./judge.ts";
import { operatorPage } from "./operator.ts";
import { GateService, taskInput, writeInput } from "./service.ts";
import { durableStore, type GateState } from "./storage.ts";
import { GateError, type AiBinding, type NativeCaller } from "./types.ts";

type Stub = { fetch(request: Request): Promise<Response> };
export type NativeEnv = AuthEnv & {
  AI?: AiBinding;
  GATES: { idFromName(name: string): unknown; get(id: unknown): Stub };
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

// This class is reachable only through its Worker binding, never via a public URL.
export class NativeGate {
  private service: GateService;
  constructor(ctx: GateState, env: NativeEnv) {
    const ai = env.NATIVE_MODE === "fixture" ? fixtureAi : env.AI;
    this.service = new GateService(durableStore(ctx), ai ? createJudge(ai) : async () => ({ verdict: "uncertain", reason: "model_unavailable" }));
  }
  async fetch(request: Request) {
    const { caller, operation, input } = await request.json() as { caller: NativeCaller; operation: string; input: unknown };
    this.service.initialize(caller.tenantId);
    try {
      switch (operation) {
        case "list": return json(this.service.list(caller));
        case "disable": return json(await this.service.disable(caller, writeInput.parse(input)));
        case "task": return json(this.service.createTask(caller, taskInput.parse(input)));
        case "review": return json(this.service.review(caller, z.string().uuid().parse(input)));
        case "approve": return json(this.service.approve(caller, z.string().uuid().parse(input)));
        default: return json({ error: "Not found" }, 404);
      }
    } catch (error) {
      if (error instanceof GateError || error instanceof AccessDenied) return json({ error: error.message }, 403);
      if (error instanceof z.ZodError) return json({ error: "Invalid input" }, 400);
      return json({ error: "Operation unavailable" }, 503);
    }
  }
}

async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new GateError("JSON required");
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new RangeError(); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

export default {
  async fetch(request: Request, env: NativeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!configurationAllows(request, env)) return json({ error: "Configure the native environment; fixtures are local-only" }, 503);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Origin not permitted" }, 403);
    if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", mode: env.NATIVE_MODE, synthetic: true });
    if (url.pathname === "/operator" && request.method === "GET") return operatorPage();
    const caller = await authenticateNative(request, env);
    if (!caller) return json({ error: "Valid identity required" }, 401);
    const gate = env.GATES.get(env.GATES.idFromName(caller.tenantId));
    const invoke = async (operation: string, input: unknown) => {
      const response = await gate.fetch(new Request("https://internal/gate", {
        method: "POST", body: JSON.stringify({ caller, operation, input }),
      }));
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new GateError(result.error ?? "Operation unavailable");
      return result;
    };
    let parsedBody: unknown;
    if (request.method === "POST") {
      try { parsedBody = await readJson(request); }
      catch (error) { return json({ error: error instanceof RangeError ? "Request too large" : "Valid JSON required" }, error instanceof RangeError ? 413 : error instanceof GateError ? 415 : 400); }
    }
    try {
      if (url.pathname.startsWith("/operator/")) {
        if (caller.role !== "operator") return json({ error: "Independent operator required" }, 403);
        if (url.pathname === "/operator/tasks" && request.method === "POST") return json(await invoke("task", taskInput.parse(parsedBody)));
        if (url.pathname === "/operator/approvals" && request.method === "POST") {
          const body = z.object({ reviewId: z.string().uuid() }).strict().parse(parsedBody);
          return json(await invoke("approve", body.reviewId));
        }
        const reviewMatch = /^\/operator\/reviews\/([0-9a-f-]+)$/.exec(url.pathname);
        if (reviewMatch && request.method === "GET") return json(await invoke("review", reviewMatch[1]));
        return json({ error: "Not found" }, 404);
      }
      if (url.pathname !== "/mcp") return json({ error: "Not found" }, 404);
      if (caller.role !== "agent") return json({ error: "Agent identity required" }, 403);
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "yunhai-native-guardrail", version: "1.0.0" });
        const tool = async (operation: string, input: unknown) => {
          try {
            const result = await invoke(operation, input) as { status?: string };
            return { isError: result.status === "blocked" || result.status === "review_required", content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          } catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof GateError ? error.message : "Operation unavailable" }] }; }
        };
        server.registerTool("list_integrations", { inputSchema: {}, description: "List synthetic resources belonging to the current tenant.", annotations: { readOnlyHint: true } }, () => tool("list", {}));
        server.registerTool("disable_webhook", {
          inputSchema: writeInput.shape,
          description: "Review a webhook disable against a server-held trusted task. Execution requires a separate operator's short-lived approval. Never claim execution when status is approval_required.",
          annotations: { readOnlyHint: false, destructiveHint: true },
        }, (input) => tool("disable", writeInput.parse(input)));
        return server;
      }, {
        route: "/mcp", responseMode: "json", corsOptions: false,
        allowedHostnames: env.NATIVE_MODE === "fixture" ? LOCAL_HOSTS : [url.hostname],
        allowedOriginHostnames: [url.hostname],
      });
      const response = await handler.fetch(request, { parsedBody });
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return json({ error: error instanceof GateError ? error.message : "Invalid request" }, error instanceof GateError ? 403 : 400);
    }
  },
};
