# Yunhai agent tool standard

Principal Solutions Architect (Greater China) take-home submission. All records and identities are synthetic.

- [Written plan, architecture diagrams and checklist](submission/Yunhai_Agent_Tool_Standard.pdf)
- [Worker README: install, run and verify](submission/README.md)
- [Cloudflare sources and where they are used](submission/CLOUDFLARE_DOCS.md)
- [Validation record](submission/VALIDATION.md)
- [English code explanation](submission/KEY_CODE_LINE_BY_LINE_EN.md)
- [Chinese/English code explanation](submission/KEY_CODE_LINE_BY_LINE.md)

## Run locally

Requires Node.js 24+ and pnpm 11.25.0. From this repository's root:

```sh
cd submission
pnpm install --frozen-lockfile
bash scripts/test-local.sh
```

The helper runs unit tests, type checking, a dry-run Worker bundle and the core HTTP/MCP checks, then stops the local server it started. See the Worker README for manual requests and the optional approval extension.

This package demonstrates local authorization on a Worker. Production OAuth, Cloudflare account entitlements, regional confinement and live model accuracy remain rollout gates described in the plan.
