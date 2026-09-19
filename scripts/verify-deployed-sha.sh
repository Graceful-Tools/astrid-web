#!/usr/bin/env bash
#
# Ask production which commit it is serving, and wait until it is the one we
# deployed.
#
# WHY THIS EXISTS (AWTD-959). The deploy step decided success by regexing a URL
# out of `vercel deploy` stdout. When the CLI hung and the runner cancelled it,
# the job reported FAILED about a deploy that had in fact gone out — and the
# Health Check, being `needs:` the deploy job, was skipped. So the one run where
# production was actually broken is the run with no verification at all.
#
# Production can simply be asked. /api/health reports VERCEL_GIT_COMMIT_SHA as
# `commitSha` (app/api/health/route.ts). On 2026-09-18 it answered
# 25712912185a3ebc268b40756ac622b40ec02dd4 — the SHA of the deploy the job had
# declared a failure.
#
# A commit SHA is the right question. The old health check curled the home page
# for a 200, which it returned throughout the outage while every list read 500'd,
# so a status code was never evidence that the right code was live.
#
# Usage:
#   verify-deployed-sha.sh <expected-sha> [--url https://astrid.cc] [--timeout 300]
#   verify-deployed-sha.sh <expected-sha> --from-json-file <path>   # one payload, no polling
#
# Exit 0 = production is serving that commit.
# Exit 1 = it is not, or it never got there within the timeout.

set -euo pipefail

expected="${1:-}"
url="https://astrid.cc"
timeout_seconds=300
json_file=""

if [ -z "$expected" ]; then
  echo "usage: verify-deployed-sha.sh <expected-sha> [--url URL] [--timeout SECONDS]" >&2
  exit 2
fi
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    --timeout) timeout_seconds="$2"; shift 2 ;;
    --from-json-file) json_file="$2"; shift 2 ;;
    *) echo "❌ unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Pull `commitSha` out of the health payload. A dedicated grep rather than jq,
# which is not guaranteed on a runner, and rather than matching `version` — that
# field carries the same value but is the one most likely to be repurposed.
extract_sha() {
  grep -oE '"commitSha"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -1 \
    | sed -E 's/.*"commitSha"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

# Equal, or one is the abbreviation of the other. `git rev-parse --short` and
# GITHUB_SHA disagree in length, not in identity.
sha_matches() {
  local actual="$1"
  [ -n "$actual" ] || return 1
  [ "$actual" != "unknown" ] || return 1
  case "$expected" in "$actual"*) return 0 ;; esac
  case "$actual" in "$expected"*) return 0 ;; esac
  return 1
}

if [ -n "$json_file" ]; then
  actual=$(extract_sha < "$json_file" || true)
  if sha_matches "$actual"; then
    echo "✅ serving $actual"
    exit 0
  fi
  echo "❌ expected $expected, serving ${actual:-(no commitSha in payload)}" >&2
  exit 1
fi

echo "🔍 Waiting for $url to serve $expected (up to ${timeout_seconds}s)..."

deadline=$(( $(date +%s) + timeout_seconds ))
attempt=0
actual=""

while [ "$(date +%s)" -lt "$deadline" ]; do
  attempt=$((attempt + 1))
  payload=$(curl -sS --max-time 15 "$url/api/health" 2>/dev/null || true)
  actual=$(printf '%s' "$payload" | extract_sha || true)

  if sha_matches "$actual"; then
    echo "✅ $url is serving $actual (after ${attempt} check(s))"
    exit 0
  fi

  echo "   attempt ${attempt}: serving ${actual:-(no answer)}, waiting for $expected"
  sleep 10
done

echo "" >&2
echo "❌ $url did not serve $expected within ${timeout_seconds}s." >&2
echo "   Last answer: ${actual:-(none)}" >&2
echo "   This is a REAL deploy failure — production is running other code." >&2
exit 1
