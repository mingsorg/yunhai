# Submission validation

Reviewed on 11 October 2026 against the take-home requirements and the exact clean repository copy.

## Requirements and documents

- The written plan has four narrative pages, a one-page checklist appendix and two diagram pages.
- The CTO note contains 224 words, within the requested 150–250 words.
- The plan covers stakeholder discovery, pilot choice and deferrals, measurable targets, both-cloud regional architecture, Shanghai access gates, three risks, alternatives, rollout owners and product feedback.
- The required slice contains a local Worker MCP server, one read tool and one write tool, synthetic identities/data, authorization outside the prompt, denied-write examples and a stated limitation.
- The seven PDF pages were rendered and visually reviewed.
- The English and Chinese/English code guides refer to the current required implementation. The optional approval extension is explicitly separated in the README.

## Links and source use

- All 20 distinct external source links returned HTTP 200. The EDPB PDF follows a valid redirect to its current document path.
- All 40 PDF hyperlink annotations resolve to checked sources (15 distinct targets).
- All relative document links resolve within this repository.
- `CLOUDFLARE_DOCS.md` maps each source to its actual use. S13 is background for the out-of-region access decision; S15 supports local development instructions. They are not presented as individual PDF citations.
- The three optional implementation references support the Clef adapter, Access JWT validation and SQLite transaction code. Their presence does not prove a live deployment or model accuracy.

## Reproducible verification

Clean installation used Node.js 24 and pnpm 11.25.0 with `pnpm install --offline --frozen-lockfile`; all 203 packages were available from the local cache. The README's normal installation uses the registry.

| Check | Result |
| --- | --- |
| Unit tests (`pnpm test`) | 23 passed |
| Type check (`pnpm typecheck`) | Passed |
| Required Worker bundle (`pnpm build:check`) | Passed, dry run |
| Core live verifier (`pnpm verify`) | 14 passed |
| Optional cloud-mode bundle (`pnpm native:build`) | Passed, dry run |
| Optional local verifier (`pnpm native:verify`) | 12 passed |
| Python walkthrough (`test_deployment.py --local`) | 9 passed; 1 Access check skipped because local mode has no Access |
| Common private-key/API-token credential patterns | No findings in the upload copy |

The core helper ran on localhost port 8793; the optional extension ran on 8795 to avoid existing services. Servers started for this review were stopped afterward. The sandbox's initial loopback bind denial was resolved by allowing the local server; no application repair was needed for that failure.

## Repairs and upload contents

- Removed README links to three absent files: the Chinese PDF, `KEY_CODE.md` and `CODE_FLOW.html`. The existing bilingual code guide remains available.
- Corrected the repository-root instructions to enter `submission/` before installing or running commands.
- Added the English code-guide link and source-use map.
- Replaced the old `test-ts.sh` process-killing walkthrough with an alias for the existing helper, which refuses a busy port and stops only its own server. Updated its README description.
- Clarified that Regional Services SLA terms depend on the Enterprise contract.
- The repository contains `submission/` plus a root README, ignore rules and PDF binary-file attributes. Dependencies, Wrangler state, build output, logs, environment secrets, OS files, old bundles and workspace review drafts are excluded.

## What this validates

This is a runnable local authorization demonstration and a documented production proposal. Live Access/OAuth, Cloudflare account entitlements, regional confinement, legal approvals, live Clef quality and production operations remain unverified rollout gates. The local fixtures are not evidence that a model detects arbitrary abuse.
