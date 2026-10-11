# Key code, line by line

Every key file has English comments in the source (`src/`). This document gives the line numbers and explains each part.

---

## 1. `src/auth.ts`: who is calling

| Line | Code | Explanation |
| --- | --- | --- |
| 2–6 | `export type Caller = Readonly<{...}>` | The shape of a caller. `Readonly` prevents typed mutation at compile time; runtime freezing is done below. |
| 9–13 | `const TOKENS = Object.freeze({...})` | The only source of identity: a fixed, frozen table. |
| 16 | `export function authenticate(request)` | Returns a caller, or `null` for unknown tokens (HTTP 401). |
| 18 | `/^Bearer ([A-Za-z0-9-]+)$/i.exec(...)` | Accepts only `Bearer <token>` with letters, digits and dashes. |
| 20 | `if (!match \|\| !Object.hasOwn(TOKENS, match[1])) return null;` | Rejects malformed headers and unknown tokens. `Object.hasOwn` blocks names like `__proto__`. |
| 21 | `const known = TOKENS[match[1]];` | Looks up this token's caller. |
| 23 | `return Object.freeze({ ...known, scopes: ... });` | Returns a fresh, frozen copy, so no request can change the shared table. |

---

## 2. `src/policy.ts`: the two rules

| Line | Code | Explanation |
| --- | --- | --- |
| 4–6 | `class AccessDenied extends Error` | One denial type, one fixed message. It never says why access was refused. |
| 9–11 | `requireScope(caller, scope)` | Action-level check: does the token carry the required scope? |
| 10 | `if (!caller.scopes.includes(scope)) throw new AccessDenied();` | Missing scope means denial. |
| 14–17 | `requireOwnedResource(caller, tenantId)` | Resource-level check: does the target belong to the caller's tenant? |
| 16 | `if (tenantId !== caller.tenantId) throw new AccessDenied();` | Missing (`undefined`) and foreign targets fail the same way. |

---

## 3. `src/origin.ts`: the only place a write happens

| Line | Code | Explanation |
| --- | --- | --- |
| 12–15 | `const records = new Map(...)` | Synthetic data, one webhook per tenant, held in memory. |
| 18–21 | `function record(event)` | Adds an audit event; keeps at most 100. |
| 24–28 | `list(caller)` | Read: checks `integrations:read`, then returns only this tenant's rows and safe fields. |
| 30 | `disable(caller, webhookId)` | The only function that changes data. |
| 32–35 | `const event = {...}` | Builds the audit record before any check, so denied attempts are recorded too. |
| 36, 40 | `let stage = "scope";` … `stage = "ownership";` | Tracks which check is running, so a denial can be logged with its reason. |
| 39 | `requireScope(caller, "webhooks:write");` | Check 1: the caller has write permission. |
| 41 | `const target = records.get(webhookId);` | Looks up the target in the origin's own data, not in anything the agent said. |
| 42 | `requireOwnedResource(caller, target?.tenantId);` | Check 2: the target belongs to the caller's tenant. |
| 44 | `const changed = target!.webhookEnabled;` | Records the previous state. `!` is safe because line 42 throws if `target` is undefined. |
| 45 | `target!.webhookEnabled = false;` | The write. Happens only after both checks pass. |
| 46 | `record({ ...event, outcome: "allowed", changed });` | Audits the allowed write. |
| 47 | `return { webhookId, webhookEnabled: false, changed, auditEventId }` | The result for the caller. |
| 48–54 | `catch (error) {...}` | Any denial is audited (line 50), logged to the console (line 52), then rethrown. The audit record holds no token, ticket text or foreign target details. |
| 52 | `console.log(... DENIED ... reason=${stage})` | Local denial diagnostic: actor, tenant and reason (`scope` or `ownership`). It never logs the requested target ID, which may belong to another tenant. |
| 57 | `auditSnapshot()` | Returns copies, so callers cannot change the audit log. |

---

## 4. `src/tools.ts`: the menu the model can choose from

| Line | Code | Explanation |
| --- | --- | --- |
| 8 | `createToolServer(caller, origin)` | One MCP server per caller. Tools only forward; the origin enforces the rules. |
| 11 | `const result = (data) => ...` | Wraps successful data as MCP text content. |
| 13–19 | `const guard = (operation) => ...` | Turns a denial into a tool error with the fixed text; rethrows other errors. |
| 21–25 | `registerTool("list_integrations", ...)` | Read tool with no input (`inputSchema: {}`). |
| 27–34 | `registerTool("disable_webhook", ...)` | Write tool. |
| 29 | `inputSchema: { webhookId: z.string().regex(/^wh-[a-z]-[0-9]+$/).max(40) }` | `webhookId` must look like `wh-a-1`. URLs or invalid text in `webhookId` are rejected before the origin is called; other fields cannot grant authority. |
| 30 | `annotations: { ... destructiveHint: true ... }` | Hints for MCP clients only. They are not security controls. |
| 33 | `return origin.disable(caller, webhookId);` | Only forwards. The origin does the checking. |

---

## 5. `src/index.ts`: entry and per-request server

| Line | Code | Explanation |
| --- | --- | --- |
| 7 | `const origin = createMockOrigin();` | One shared mock origin per process; data resets on restart. |
| 9 | `const LOCAL = new Set([...])` | Only localhost hostnames are accepted. |
| 11 | `const MAX_BYTES = 16_384;` | Body limit: 16 KiB. |
| 17–31 | `readBody(request)` | Reads in chunks and stops as soon as the limit is exceeded (line 27). |
| 37–39 | `if (SYNTHETIC_DEMO !== "true" \|\| !LOCAL.has(...)) return 503` | Refuses everything outside localhost. This is why a deployed copy returns 503. |
| 41–42 | Host header check | Rejects a Host header that does not match the URL (HTTP 403). |
| 43 | `/health` | Public health check for local use. |
| 44 | `if (url.pathname !== "/mcp") return 404` | Every other path is not found. |
| 46–47 | `authenticate(request)`, then 401 | No valid token, no MCP access. |
| 49–52 | `createMcpHandler(() => createToolServer(caller, origin), ...)` | A new MCP server per request, bound to that request's caller. CORS is off, and browser Origins are limited to localhost. |
| 54–63 | Media type (415), size (413), JSON parse (400) | Checks before MCP sees the request. |
| 66–69 | `handler.fetch(...)` and `Cache-Control: no-store` | Passes the request to MCP; responses are never cached. |

**Honest note:** `origin` (line 7) is shared across requests, so "a new server per request" applies to the MCP server and caller identity, not to the data. Production needs persistent regional storage.

---

## Summary

| Idea | Where |
| --- | --- |
| Identity comes only from the token | `auth.ts` 16–23 |
| Two checks before a write | `origin.ts` 39–42, `policy.ts` |
| The model can only pick from the tool menu | `tools.ts` 21–34 |
| Every `origin.disable` authorization decision is audited | `origin.ts` 32–54 |
| Denials are logged without the target ID | `origin.ts` 52 |
| Non-local requests refused | `index.ts` 37–39 |
