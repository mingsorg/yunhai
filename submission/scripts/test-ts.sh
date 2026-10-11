#!/usr/bin/env bash
# Compatibility alias for the local synthetic verification helper.
# Refuses a busy port and stops only the server it starts.
set -eu
cd "$(dirname "$0")/.."
exec node scripts/test-local.mjs
