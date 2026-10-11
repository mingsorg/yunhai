# Cloudflare documentation relied on

Checked on 11 October 2026. The entries support the PDF, implementation or the explicitly labelled background decision below. None is a legal determination or proof of a particular account's entitlements.

| ID | Source | Claim it supports |
| --- | --- | --- |
| S1 | [Workers localization](https://developers.cloudflare.com/data-localization/how-to/workers/) | A Worker custom domain with Regional Services restricts where HTTPS is decrypted and the Worker runs; code and secrets still deploy globally; subrequests need separate review. |
| S2 | [Regional Services](https://developers.cloudflare.com/data-localization/regional-services/) | Enterprise add-on. Single-country regions (except the US) have SLA exclusions with no failover outside the country; multi-country regions such as the EU generally maintain the standard SLA, subject to contract. Egress IP geolocation isn't guaranteed. |
| S3 | [Region support](https://developers.cloudflare.com/data-localization/region-support/) | Singapore, EU, Germany and US are Regional Services regions; Indonesia is not listed. The metadata boundary is available only for the EU and US. |
| S4 | [Customer Metadata Boundary](https://developers.cloudflare.com/data-localization/metadata-boundary/) | Log and analytics metadata location: EU or US only; separate from processing location. |
| S5 | [Durable Objects data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) | Jurisdictions are eu, us and fedramp only; location hints such as apac-se are best effort; Durable Object IDs are logged outside the jurisdiction. |
| S6 | [Access: purpose justification](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/require-purpose-justification/) | Users state why they need access at the start of each session; the reason is auditable. |
| S7 | [Access: temporary authentication](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/temporary-auth/) | An approver grants access for a set time of up to 24 hours; users request again each session. |
| S8 | [China Network: Global Acceleration](https://developers.cloudflare.com/china-network/concepts/global-acceleration/) | Cloudflare One Client can be used in mainland China through Cloudflare's partners (CMI, CBC Tech, JD Cloud). |
| S9 | [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) | Per-key limits inside a Worker; counters are per Cloudflare location and eventually consistent. |
| S10 | [MCP handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) | Stateless `createMcpHandler` with a per-request server factory; authentication is the server's responsibility. |
| S11 | [The next generation of MCP](https://blog.cloudflare.com/mcp-v2/) | MCP 2026-07-28 is stateless; `Mcp-Method` / `Mcp-Name` headers; Workers OAuth Provider supports audience-bound tokens (RFC 8707). |
| S12 | [The Agent Access Model](https://blog.cloudflare.com/the-agent-access-model/) | Framework used: short-lived task-scoped credentials, enforcement outside the prompt, selective human approval, trust ratchet, agent activity log. |
| S13 | [Out-of-region access](https://developers.cloudflare.com/data-localization/metadata-boundary/out-of-region-access/) | Remote dashboard access to regional metadata is a separate setting; not enabled by default in this design. |
| S14 | [Product compatibility](https://developers.cloudflare.com/data-localization/compatibility/) | Check each product separately: Access JWT is not localized; Access processing localization is limited to US FedRAMP Moderate Domestic; EU Access logs require Logpush. Tunnel connector region differs from Regional Services. |
| S15 | [Workers get-started guide](https://developers.cloudflare.com/workers/get-started/guide/) | Wrangler local development used in this README. |
| S16 | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) | `cloudflared` makes outbound-only connections, so origins need no publicly routable address. |
| - | [Clef-flash model](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | Used only by the optional extension. |

Claims deliberately not made: that any single setting keeps *all* of a region's data in that region; that Cloudflare supports Indonesia-only processing or SEA metadata localization today; that technically controlled operator access is lawful (legal decides per region and data class). The legal regimes named in the PDF (GDPR Chapter V, Singapore PDPA, Indonesia UU PDP, US DOJ Data Security Program) are questions for counsel, not Cloudflare documentation claims.

S17 (legal supporting source): [EDPB Guidelines 05/2021, final version](https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf). Chapter V classification depends on the entities, roles and data disclosure; employee access within the same controller is distinguished from disclosure to a separate third-country controller/processor. Legal must assess Yunhai's actual arrangement. This is not a Cloudflare product claim.


## Where the sources are used

PDF page numbers below refer to the physical seven-page file: four narrative pages, one checklist page and two diagram pages. The combined source-range mention on page 4 is not counted as an individual citation.

| Sources | Actual use |
| --- | --- |
| S1 | PDF pages 2 and 7: Worker execution versus globally distributed code/secrets. |
| S2 | PDF pages 1, 2 and 6: regional processing, entitlement and failover trade-offs. |
| S3 | PDF pages 1, 2 and 6: regional support and Singapore pilot choice. |
| S4 | PDF pages 1, 2, 4, 6 and 7: metadata boundary and SEA gap. |
| S5 | PDF pages 2, 4 and 6: Durable Objects jurisdictions and Singapore storage alternative. |
| S6, S7 | PDF pages 3 and 7: operator purpose and temporary access approval. |
| S8 | PDF pages 3 and 7: mainland operator connectivity. |
| S9 | PDF page 2: proposed rate limits; not implemented by the required PoC. |
| S10 | PDF page 3 and `src/index.ts`: per-request MCP handler. |
| S11 | PDF pages 2 and 3: proposed OAuth migration and protocol background; live OAuth is not implemented. |
| S12 | PDF pages 1 and 3: task authority, approvals and trust ratchet. |
| S13 | Background for this source register's default decision: keep CMB out-of-region access disabled pending the regional legal gate. Not individually cited in the PDF; not account configuration evidence. |
| S14 | PDF pages 2 and 3: product-specific localization limitations and operator action audit. |
| S15 | Implementation reference for the README's local Wrangler workflow; not individually cited in the PDF. |
| S16 | PDF pages 2, 6 and 7: proposed outbound-only origin connectivity. Tunnel is not configured by the local PoC. |
| S17 | PDF page 2: legal entity/role review for Shanghai access. Counsel must decide the actual arrangement. |
| Clef-flash | `src/native/judge.ts`: optional `ai.run` request/response contract. Local verification uses fixtures, not live model inference. |
| Access JWT validation | `src/native/auth.ts`: optional signature, issuer, audience and expiry checks; test keys are local fixtures. |
| SQLite storage | `src/native/storage.ts`: optional SQL storage and synchronous transaction for approval, write and audit. |
