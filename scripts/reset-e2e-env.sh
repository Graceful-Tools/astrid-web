#!/usr/bin/env bash
#
# Reset the dev-server state before a Playwright run.
#
# Why: predeploy:full reuses an existing dev server (playwright's reuseExistingServer
# is true locally). A long-lived dev server with an accumulated .next/cache can
# degrade enough that pages start returning Internal Server Error under parallel
# Playwright load — confirmed by a 75-failure cascade that disappeared after a
# kill+cache-clear. This script makes that reset explicit and reproducible.
#
# Effect: kills anything bound to port 3000 and clears .next/cache. Playwright
# will then spawn a fresh dev server with a cold cache.
set -euo pipefail

PORT="${PLAYWRIGHT_DEV_PORT:-3000}"

echo "[reset-e2e-env] Killing any process bound to port ${PORT}..."
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti ":${PORT}" 2>/dev/null || true)"
  if [ -n "${PIDS}" ]; then
    # shellcheck disable=SC2086
    kill -9 ${PIDS} 2>/dev/null || true
    sleep 1
    echo "[reset-e2e-env]   killed PIDs: ${PIDS}"
  else
    echo "[reset-e2e-env]   no process on :${PORT}"
  fi
else
  echo "[reset-e2e-env]   lsof not available, skipping port kill"
fi

echo "[reset-e2e-env] Clearing .next/cache..."
rm -rf .next/cache

echo "[reset-e2e-env] Done."
