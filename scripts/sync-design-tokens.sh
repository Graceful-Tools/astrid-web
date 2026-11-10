#!/usr/bin/env bash
# Re-vendor packages/astrid-design/ — astrid-core's generated design tokens — at a pinned revision.
#
#   scripts/sync-design-tokens.sh                 # re-copy at the revision in REVISION
#   scripts/sync-design-tokens.sh --rev <sha>     # move the pin, then copy
#   scripts/sync-design-tokens.sh --core <dir>    # read this checkout (default ../astrid-core)
#
# The same discipline as packages/astrid-rules: the web draws exactly the revision recorded in
# packages/astrid-design/REVISION, and moving it is a reviewable commit that changes REVISION and
# the copied files together. A value is never edited here. It changes in astrid-core's
# design/tokens.json (the iOS and Mac apps are the reference), is regenerated there, and arrives
# by running this script. docs/specs/DESIGN_SYSTEM.md has the whole order.
#
# What lands in packages/astrid-design/:
#   REVISION               the astrid-core commit the files were copied from
#   astrid-tokens.css      CSS custom properties (--astrid-*), imported by app/[locale]/layout.tsx
#   tokens.resolved.json   the same values as data, for lib/design and the tests
set -euo pipefail

web="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$web/packages/astrid-design"
core="$web/../astrid-core"
rev=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rev) rev="$2"; shift 2 ;;
    --core) core="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$rev" ]] || rev="$(tr -d '[:space:]' <"$pkg/REVISION")"
git -C "$core" rev-parse --git-dir >/dev/null 2>&1 || { echo "no astrid-core checkout at $core (pass --core)" >&2; exit 1; }
git -C "$core" fetch --quiet origin || true
rev="$(git -C "$core" rev-parse --verify "$rev^{commit}")"

mkdir -p "$pkg"
git -C "$core" show "$rev:design/generated/web/astrid-tokens.css" >"$pkg/astrid-tokens.css"
git -C "$core" show "$rev:design/generated/tokens.resolved.json" >"$pkg/tokens.resolved.json"
printf '%s\n' "$rev" >"$pkg/REVISION"

echo "packages/astrid-design is astrid-core $rev"
