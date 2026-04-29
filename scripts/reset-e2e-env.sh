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
# Effect: kills any next dev/server process (port 3000 listeners + stragglers
# like next-server children that orphaned from a previous webServer spawn),
# then clears the on-disk dev caches that have been seen to poison runs
# (.next/, .turbo/, node_modules/.cache/). Playwright will then spawn a fresh
# dev server with cold caches.
#
# Why nuke the entire .next directory and not just .next/cache: clearing only
# .next/cache reproducibly let "Download is starting" failures cascade across
# the first hits of /es, /fr, etc. when the prior run had crashed mid-compile
# and left half-written .next/server output behind. A full .next wipe is the
# difference between an 88/2-flaky run and a 75-failure run on a poisoned
# checkout.
set -euo pipefail

PORT="${PLAYWRIGHT_DEV_PORT:-3000}"

echo "[reset-e2e-env] Killing any next dev/server processes..."
# Kill anything on the port first.
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti ":${PORT}" 2>/dev/null || true)"
  if [ -n "${PIDS}" ]; then
    # shellcheck disable=SC2086
    kill -9 ${PIDS} 2>/dev/null || true
    echo "[reset-e2e-env]   killed :${PORT} listeners: ${PIDS}"
  fi
fi
# Then kill any orphaned next workers that aren't on the port.
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
sleep 1

echo "[reset-e2e-env] Clearing dev caches (.next, .turbo, node_modules/.cache)..."
rm -rf .next .turbo node_modules/.cache

echo "[reset-e2e-env] Done."
