#!/usr/bin/env bash
# Says whether keys are set in the local env file, never what they are set to. For agents: the
# secret guard (block-secret-dump.py) refuses most commands that read .env.local, rightly, and an
# agent usually only needs to know whether a key exists (2026-11-28 session analysis: 29 blocked
# commands, nearly all of that kind).
#
#   scripts/env-has.sh SOCKET_API_TOKEN SOCKET_ORG_SLUG
#   SOCKET_API_TOKEN set
#   SOCKET_ORG_SLUG missing
#
#   --file <path>   another env file (default: .env.local at the repo root)
#
# Exit status: 0 when every key is set, 1 when any is missing or empty, 2 on bad usage.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
file="$root/.env.local"
if [[ "${1:-}" == "--file" ]]; then file="${2:?--file needs a path}"; shift 2; fi
[[ $# -gt 0 ]] || { echo "usage: scripts/env-has.sh [--file <path>] KEY [KEY...]" >&2; exit 2; }
[[ -f "$file" ]] || { echo "no env file at $file" >&2; exit 2; }

status=0
for key in "$@"; do
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "not a key name: $key" >&2; exit 2; }
  # A line `KEY=` followed by at least one character that is not a closing quote or whitespace.
  if grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*['\"]?[^'\"[:space:]]" "$file"; then
    echo "$key set"
  else
    echo "$key missing"; status=1
  fi
done
exit "$status"
