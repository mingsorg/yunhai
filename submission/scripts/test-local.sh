#!/usr/bin/env bash
# Local synthetic verification. Requires Node 24+, pnpm 11.25.0 and installed dependencies.
# Stops only its own development server. Override the default port with MCP_TEST_PORT.
set -eu
cd "$(dirname "$0")/.."
exec node scripts/test-local.mjs
