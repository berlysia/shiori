#!/usr/bin/env bash
# ADR 028 envelope guard: detect raw JSON.stringify in CLI wrapper files.
# CLI wrappers (*-cli.ts) must use wrapOutputJson() from schema-envelope.ts
# for all JSON output to ensure the meta+data envelope is applied.
set -euo pipefail

matches=$(grep -rn 'JSON\.stringify' src/commands/*-cli.ts 2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "ERROR: Raw JSON.stringify found in CLI wrappers (ADR 028 violation):" >&2
  echo "$matches" >&2
  echo "" >&2
  echo "Use wrapOutputJson() from ../core/schema-envelope.ts instead." >&2
  exit 1
fi
