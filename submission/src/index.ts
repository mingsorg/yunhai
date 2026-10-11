import { createMcpHandler } from "agents/mcp/server";
import { authenticate } from "./auth.ts";
import { createMockOrigin } from "./origin.ts";
import { createToolServer } from "./tools.ts";

type Env = { SYNTHETIC_DEMO?: string };
const origin = createMockOrigin(); // Demonstration state only: resets on restart; isolate-local.
// Only localhost hostnames are accepted.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Request body limit: 16 KiB.
const MAX_BYTES = 16_384;
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
});

// Read the body in chunks; stop as soon as it exceeds the limit.
async function readBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError("Request too large"); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Published demo credentials are valid only for this local exercise.
    if (env.SYNTHETIC_DEMO !== "true" || !LOCAL.has(url.hostname)) {
      return json({ error: "Synthetic demo is local-only" }, 503);
    }
    // Reject requests whose Host header does not match the URL.
    const host = request.headers.get("host");
    if (host && host !== url.host) return json({ error: "Invalid host" }, 403);
    if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", synthetic: true });
    if (url.pathname !== "/mcp") return json({ error: "Not found" }, 404);
    // Identity comes from the token only.
    const caller = authenticate(request);
    if (!caller) return json({ error: "Valid synthetic bearer token required" }, 401, { "WWW-Authenticate": "Bearer" });
    // A new MCP server per request, bound to this request's caller.
    const handler = createMcpHandler(() => createToolServer(caller, origin), {
      route: "/mcp", responseMode: "json", corsOptions: false,
      allowedHostnames: [...LOCAL], allowedOriginHostnames: ["localhost", "127.0.0.1"],
    });
    // Check media type and size, then parse JSON before MCP sees the request.
    let parsedBody: unknown;
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return json({ error: "application/json required" }, 415);
      }
      try { parsedBody = JSON.parse(await readBody(request)); }
      catch (error) {
        if (error instanceof RangeError) return json({ error: "Request exceeds 16 KiB" }, 413);
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      }
    }
    // Responses are never cached.
    const response = await handler.fetch(request, { parsedBody });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  },
};
