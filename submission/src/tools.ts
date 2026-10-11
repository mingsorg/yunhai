import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Caller } from "./auth.ts";
import type { MockOrigin } from "./origin.ts";
import { AccessDenied } from "./policy.ts";

// One MCP server per caller. Tools only forward; the origin enforces the rules.
export function createToolServer(caller: Caller, origin: MockOrigin) {
  const server = new McpServer({ name: "yunhai-tool-standard", version: "1.0.0" });
  // Wrap successful data as MCP text content.
  const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
  // Turn a policy denial into a tool error with a fixed message; rethrow other errors.
  const guard = (operation: () => unknown) => {
    try { return result(operation()); }
    catch (error) {
      if (!(error instanceof AccessDenied)) throw error;
      return { isError: true, content: [{ type: "text" as const, text: "Action not permitted" }] };
    }
  };
  // Read tool: no input parameters.
  server.registerTool("list_integrations", {
    description: "List synthetic integrations owned by the authenticated tenant.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, () => guard(() => origin.list(caller)));
  // Write tool: webhookId must look like wh-a-1 before the origin is called.
  server.registerTool("disable_webhook", {
    description: "Disable an owned synthetic webhook. Requires webhooks:write; enforced by the origin.",
    inputSchema: { webhookId: z.string().regex(/^wh-[a-z]-[0-9]+$/).max(40) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ webhookId }) => guard(() => {
    // Origin enforces scope and ownership and audits all business authorization decisions.
    return origin.disable(caller, webhookId);
  }));
  return server;
}
