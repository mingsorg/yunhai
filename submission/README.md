# Yunhai agent tool standard

Take-home submission for the Principal Solutions Architect (Greater China) exercise. It proposes a zero-trust standard for exposing tools to AI agents across products, partners and regions, and includes a locally runnable Cloudflare Worker MCP server that proves the core control: **the model can propose an action, but trusted code decides.** All tenants, tokens and records are synthetic.

## Deliverables

| Brief item | Where |
| --- | --- |
| Written plan: 4 pages, checklist appendix, 2 diagrams | [Yunhai_Agent_Tool_Standard.pdf](Yunhai_Agent_Tool_Standard.pdf) |
| Code repository: Worker, configuration, tests, example requests, this README | `src/`, `wrangler.jsonc`, `tests/`, `scripts/verify.mjs` |
| Cloudflare documentation relied on | [CLOUDFLARE_DOCS.md](CLOUDFLARE_DOCS.md) |

## What the Worker proves

A local Cloudflare Worker exposes an MCP server with two tools on synthetic data:

| Tool | Input | Behaviour |
| --- | --- | --- |
| `list_integrations` | `{}` | Requires read scope; returns only the caller's tenant's integrations. |
| `disable_webhook` | `{ "webhookId": "wh-a-1" }` | Requires write scope **and** that the target belongs to the caller's tenant. Foreign and non-existent targets get the same denial. |

Authorization is enforced outside the prompt. In the prototype the mock origin checks scope and ownership through one policy module before any change; the tool layer only forwards. In production the Worker should check as well. Identity comes only from the bearer token. A caller can't supply its own tenant or scopes, and text in a support ticket can't grant permission.

## Requirements and install

Use **Node.js 24 or later** and **pnpm 11.25.0** (for example, `npm install --global pnpm@11.25.0`). Installation needs npm registry access. Running the Worker needs no Cloudflare account, API key, paid product or external service.

From the repository root, enter the submission folder first. All subsequent commands run from `submission/`:

```sh
cd submission
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:check
```

`pnpm test` runs 23 tests: 7 for the required slice (`tests/authorization.test.ts`) and 16 for the optional extension described at the end. `build:check` is a Wrangler dry-run bundle; it doesn't deploy. The committed pnpm policy allows the `esbuild` and `workerd` install scripts that Wrangler needs.

## Run and verify

Terminal 1:

```sh
pnpm dev
```

Wait for `Ready on http://127.0.0.1:8787`. Terminal 2, from the same folder:

```sh
pnpm verify
```

Expected: **14 HTTP/MCP checks passed**. They cover:

- tenant-isolated reads;
- a simulated planted-ticket write request denied for missing scope, with state unchanged (no live model is involved);
- a cross-tenant write denied the same way as a non-existent target;
- an owned write that succeeds and is idempotent;
- 401 for unknown identities;
- 403 for a hostile browser Origin;
- 400 / 413 / 415 for malformed, oversized or wrong-media requests;
- the official MCP SDK client and a legacy JSON-RPC client.

The verifier asserts outcomes and compares state around rejected and allowed write scenarios.

If port 8787 is busy, stop the old process, or run `pnpm exec wrangler dev --local --ip 127.0.0.1 --port 8790` and then `MCP_BASE_URL=http://127.0.0.1:8790 pnpm verify`. State lives in memory: restart `pnpm dev` to restore the initial fixtures. The verifier also works against already-changed state.

The Worker refuses any non-local hostname, so the public demo tokens can't work if it is ever deployed. `workers_dev` is disabled, and there is no deploy script.

## Synthetic identities

| Token (public demo fixture) | Tenant | Scopes |
| --- | --- | --- |
| `demo-a-read` | tenant-a | integrations:read |
| `demo-a-write` | tenant-a | integrations:read, webhooks:write |
| `demo-b-read` | tenant-b | integrations:read |

Initial state: tenant A owns enabled `wh-a-1`; tenant B owns enabled `wh-b-1`.

## Repeatable manual requests

Read tenant A's integrations:

```sh
curl -sS http://127.0.0.1:8787/mcp \
  -H 'Authorization: Bearer demo-a-read' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_integrations","arguments":{}}}'
```

Denied write: the reader lacks `webhooks:write`, whatever a ticket told the agent:

```sh
curl -sS http://127.0.0.1:8787/mcp \
  -H 'Authorization: Bearer demo-a-read' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"disable_webhook","arguments":{"webhookId":"wh-a-1"}}}'
```

Expected: a tool result with `isError: true` and `Action not permitted`. Repeat the read to confirm nothing changed. Then:

- Use `demo-a-write` with target `wh-b-1` to see a denied cross-tenant write.
- Use `demo-a-write` with `wh-a-1` to see it succeed.

Policy denials are MCP tool errors, so they can arrive with HTTP 200; invalid identities get HTTP 401.

## Where the control lives

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Local-only guard, authentication, 16 KiB body limit, media-type check, per-request MCP server, Origin check, no-cache responses |
| `src/auth.ts` | Fixed token lookup that produces a fresh, frozen caller; unknown or unsigned identities fail |
| `src/policy.ts` | Scope and resource-ownership rules |
| `src/origin.ts` | Mock origin: enforces authorization before any change, filters reads, idempotent disable, minimal bounded audit |
| `src/tools.ts` | MCP tool schemas and descriptions; maps policy errors to tool errors. Tool annotations are hints, not security controls. |

Audit records hold event ID, time, actor, tenant, tool, outcome and whether state changed. They exclude bearer tokens, ticket text and foreign target details. The audit buffer is in memory, capped at 100 events, and exposed only to unit tests. Denial diagnostics also go to the local console with actor, tenant and failure stage; they omit tokens, ticket text and target IDs. Production logging requires separate retention and locality validation.

## Limitation I would fix first

The fixed, long-lived demo tokens are the opposite of zero trust. I would replace them with short-lived, audience-bound OAuth tokens issued through Workers OAuth Provider, then add task scope, the trust ratchet and durable regional audit. State and audit are currently isolate-local and reset on restart. The tested missing-scope and cross-tenant write requests are denied without changing state. It does not stop an *authorised* writer from being tricked; that needs the approval and task controls described in the PDF.

## Optional extension: task-scoped approval (`src/native/`)

This is an exploration beyond the brief, and the required slice doesn't depend on it. It adds:

- a server-held trusted task that fixes the permitted action and exact target;
- single-use human approval, bound to caller, task, target, resource version and expiry, issued by a separate operator identity;
- Durable Objects (SQLite) so that consuming the approval, changing the webhook and writing the audit commit together;
- an optional Workers AI check (`@cf/cloudflare/clef-flash`) that can pause or block a request but never approve one.

Run it with `pnpm native:dev` and `pnpm native:verify` (port 8788, 12 checks). An operator page is served at `/operator`; the local operator token is `demo-operator-a`. Durable Object state persists in `.wrangler/state` across restarts.

Limits:
- Model responses are explicit local fixtures, so nothing here measures model accuracy.
- The agent supplies the ticket text the model reviews; in production the Worker should fetch the ticket by ID.
- Available Durable Object jurisdiction values are `eu`, `us` and `fedramp`; there is no Singapore jurisdiction. This prototype uses no jurisdiction restriction and proves no regional confinement.
- No live Access/OAuth integration, model accuracy or regional production validation is demonstrated by this package. The cloud configuration (`wrangler.native.jsonc`, environment `cloudflare`) is left empty and refuses traffic until configured.

## Optional local helpers and code guide

After installation, `bash scripts/test-local.sh` runs the unit tests, type check, dry-run build and 14 core HTTP/MCP checks. It uses port 8793 by default (`MCP_TEST_PORT=8794` to override), refuses a busy port and stops only the server it starts. `bash scripts/test-ts.sh` is an alias for the same helper. The manual requests above provide the walkthrough.

For a step-by-step explanation of the optional extension, first run `pnpm native:dev`, then `python3 scripts/test_deployment.py --local`. This uses only Python's standard library and local synthetic identities. Cloud mode is unverified here; its module docstring describes prerequisites for an already-configured synthetic deployment.

[English code guide](KEY_CODE_LINE_BY_LINE_EN.md) explains the current required slice. It is supplementary reading.

The source-use map in [CLOUDFLARE_DOCS.md](CLOUDFLARE_DOCS.md) distinguishes PDF citations, implementation references and background material. [VALIDATION.md](VALIDATION.md) records the final submission checks.
