# Key code, line by line / 关键代码逐行解释

Every key file now has English comments in the source (`src/`). This document gives the line numbers and explains each part in English and Chinese.
每个关键文件的源代码里都有英文注释（`src/`）。本文档给出行号，并用英文和中文解释每一部分。

---

## 1. `src/auth.ts`: who is calling / 调用者是谁

| Line / 行 | Code / 代码 | Explanation / 说明 |
| --- | --- | --- |
| 2–6 | `export type Caller = Readonly<{...}>` | The shape of a caller. `Readonly` prevents typed mutation at compile time; runtime freezing is done below. / `Readonly` 在编译时限制修改；下方的冻结负责运行时保护。 |
| 9–13 | `const TOKENS = Object.freeze({...})` | The only source of identity: a fixed, frozen table. / 唯一的身份来源：固定且冻结的表。 |
| 16 | `export function authenticate(request)` | Returns a caller, or `null` for unknown tokens (HTTP 401). / 返回调用者，未知令牌返回 `null`（HTTP 401）。 |
| 18 | `/^Bearer ([A-Za-z0-9-]+)$/i.exec(...)` | Accepts only `Bearer <token>` with letters, digits and dashes. / 只接受 `Bearer <令牌>`，字符只限字母、数字和连字符。 |
| 20 | `if (!match \|\| !Object.hasOwn(TOKENS, match[1])) return null;` | Rejects malformed headers and unknown tokens. `Object.hasOwn` blocks names like `__proto__`. / 拒绝格式错误和未知令牌。`Object.hasOwn` 阻止 `__proto__` 之类的名字。 |
| 21 | `const known = TOKENS[match[1]];` | Looks up this token's caller. / 查找该令牌对应的调用者。 |
| 23 | `return Object.freeze({ ...known, scopes: ... });` | Returns a fresh, frozen copy, so no request can change the shared table. / 返回新的冻结副本，任何请求都不能修改共享的表。 |

---

## 2. `src/policy.ts`: the two rules / 两条规则

| Line / 行 | Code / 代码 | Explanation / 说明 |
| --- | --- | --- |
| 4–6 | `class AccessDenied extends Error` | One denial type, one fixed message. It never says why access was refused. / 唯一的拒绝类型，消息固定，不说明拒绝原因。 |
| 9–11 | `requireScope(caller, scope)` | Action-level check: does the token carry the required scope? / 动作级检查：令牌是否有所需的权限？ |
| 10 | `if (!caller.scopes.includes(scope)) throw new AccessDenied();` | Missing scope means denial. / 缺少权限即拒绝。 |
| 14–17 | `requireOwnedResource(caller, tenantId)` | Resource-level check: does the target belong to the caller's tenant? / 资源级检查：目标是否属于调用者的租户？ |
| 16 | `if (tenantId !== caller.tenantId) throw new AccessDenied();` | Missing (`undefined`) and foreign targets fail the same way. / 不存在（`undefined`）和属于外租户的目标，都以相同方式失败。 |

---

## 3. `src/origin.ts`: the only place a write happens / 唯一执行写操作的地方

| Line / 行 | Code / 代码 | Explanation / 说明 |
| --- | --- | --- |
| 12–15 | `const records = new Map(...)` | Synthetic data, one webhook per tenant, held in memory. / 合成数据，每个租户一个 webhook，保存在内存中。 |
| 18–21 | `function record(event)` | Adds an audit event; keeps at most 100. / 添加审计记录，最多保留 100 条。 |
| 24–28 | `list(caller)` | Read: checks `integrations:read`, then returns only this tenant's rows and safe fields. / 读取：检查 `integrations:read`，然后只返回本租户的数据和安全字段。 |
| 30 | `disable(caller, webhookId)` | The only function that changes data. / 唯一会修改数据的函数。 |
| 32–35 | `const event = {...}` | Builds the audit record before any check, so denied attempts are recorded too. / 在任何检查之前准备审计记录，因此被拒绝的尝试也会被记录。 |
| 39 | `requireScope(caller, "webhooks:write");` | Check 1: the caller has write permission. / 检查一：调用者有写权限。 |
| 41 | `const target = records.get(webhookId);` | Looks up the target in the origin's own data, not in anything the agent said. / 在源站自己的数据中查找目标，不相信 Agent 说的话。 |
| 42 | `requireOwnedResource(caller, target?.tenantId);` | Check 2: the target belongs to the caller's tenant. / 检查二：目标属于调用者的租户。 |
| 44 | `const changed = target!.webhookEnabled;` | Records the previous state. `!` is safe because line 42 throws if `target` is undefined. / 记录修改前的状态。`!` 是安全的，因为如果 `target` 为空，第 42 行已经抛出错误。 |
| 45 | `target!.webhookEnabled = false;` | The write. Happens only after both checks pass. / 真正的写入，只在两项检查都通过后执行。 |
| 46 | `record({ ...event, outcome: "allowed", changed });` | Audits the allowed write. / 记录允许的写入。 |
| 47 | `return { webhookId, webhookEnabled: false, changed, auditEventId }` | The result for the caller. / 返回给调用者的结果。 |
| 48–54 | `catch (error) {...}` | Any denial is audited (line 50), then rethrown. The audit record holds no token, ticket text or foreign target details. / 任何拒绝都会被记录（第 50 行），然后重新抛出。审计记录不含令牌、工单内容或外租户的资源信息。 |
| 57 | `auditSnapshot()` | Returns copies, so callers cannot change the audit log. / 返回副本，调用者无法修改审计日志。 |

---

## 4. `src/tools.ts`: the menu the model can choose from / 模型能选的菜单

| Line / 行 | Code / 代码 | Explanation / 说明 |
| --- | --- | --- |
| 8 | `createToolServer(caller, origin)` | One MCP server per caller. Tools only forward; the origin enforces the rules. / 每个调用者一个 MCP 服务器。工具只转发，规则由源站执行。 |
| 11 | `const result = (data) => ...` | Wraps successful data as MCP text content. / 把成功的数据包装成 MCP 文本内容。 |
| 13–19 | `const guard = (operation) => ...` | Turns a denial into a tool error with the fixed text; rethrows other errors. / 把拒绝转换为带固定文字的工具错误；其他错误原样抛出。 |
| 21–25 | `registerTool("list_integrations", ...)` | Read tool with no input (`inputSchema: {}`). / 读取工具，没有输入参数。 |
| 27–34 | `registerTool("disable_webhook", ...)` | Write tool. / 写入工具。 |
| 29 | `inputSchema: { webhookId: z.string().regex(/^wh-[a-z]-[0-9]+$/).max(40) }` | `webhookId` must look like `wh-a-1`. URLs or invalid text in webhookId are rejected before the origin is called; other fields cannot grant authority. / `webhookId` 必须像 `wh-a-1`；该字段中的 URL 或无效文字会被拒绝，其他字段不能授予权限。 |
| 33 | `return origin.disable(caller, webhookId);` | Only forwards. The origin does the checking. / 只负责转发，检查由源站完成。 |

---

## 5. `src/index.ts`: entry and per-request server / 入口与每次请求

| Line / 行 | Code / 代码 | Explanation / 说明 |
| --- | --- | --- |
| 7 | `const origin = createMockOrigin();` | One shared mock origin per process; data resets on restart. / 每个进程共享一个模拟源站，重启后数据重置。 |
| 9 | `const LOCAL = new Set([...])` | Only localhost hostnames are accepted. / 只接受 localhost 域名。 |
| 11 | `const MAX_BYTES = 16_384;` | Body limit: 16 KiB. / 请求体上限：16 KiB。 |
| 17–31 | `readBody(request)` | Reads in chunks and stops as soon as the limit is exceeded (line 27). / 分块读取，超过上限（第 27 行）立即停止。 |
| 37–39 | `if (SYNTHETIC_DEMO !== "true" \|\| !LOCAL.has(...)) return 503` | Refuses everything outside localhost. This is why a deployed copy returns 503. / 拒绝 localhost 以外的所有请求。这就是部署后的版本返回 503 的原因。 |
| 41–42 | Host header check | Rejects a Host header that does not match the URL. / 拒绝与 URL 不一致的 Host 头。 |
| 43 | `/health` | Public health check for local use. / 本地使用的公开健康检查。 |
| 46–47 | `authenticate(request)`, then 401 | No valid token, no MCP access. / 没有有效令牌，就不能访问 MCP。 |
| 49–52 | `createMcpHandler(() => createToolServer(caller, origin), ...)` | A new MCP server per request, bound to that request's caller. / 每个请求新建一个 MCP 服务器，绑定到该请求的调用者。 |
| 54–63 | Media type (415), size (413), JSON parse (400) | Checks before MCP sees the request. / 在 MCP 处理请求之前完成检查。 |
| 66–69 | `handler.fetch(...)` and `Cache-Control: no-store` | Passes the request to MCP; responses are never cached. / 把请求交给 MCP 处理，响应不被缓存。 |

**Honest note / 诚实说明：** `origin`（第 7 行）在所有请求之间共享，所以"每次请求新建服务器"只适用于 MCP 服务器和调用者身份，**不适用于数据**。生产环境需要持久化的区域存储。/ `origin` (line 7) is shared across requests, so "a new server per request" applies to the MCP server and caller identity, not to the data. Production needs persistent regional storage.

---

## Summary / 总结

| Idea / 思路 | Where / 位置 |
| --- | --- |
| Identity comes only from the token / 身份只来自令牌 | `auth.ts` 16–23 |
| Two checks before a write / 写入前两项检查 | `origin.ts` 39–42, `policy.ts` |
| The model can only pick from the tool menu / 模型只能从工具菜单中选择 | `tools.ts` 21–34 |
| Every origin.disable authorization decision is audited / origin.disable 中的每次授权决定都审计 | `origin.ts` 32–54 |
| Non-local requests refused / 非本地请求被拒绝 | `index.ts` 37–39 |
