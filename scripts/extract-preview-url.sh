#!/usr/bin/env bash
#
# Read `vercel deploy` output on stdin, print the preview URL on stdout.
#
# This is a script rather than a line of inline YAML because the inline version
# was wrong for long enough to cost a CI cycle on PR #206, and shell embedded in
# a workflow is shell nobody can run a test against. Its contract is pinned in
# tests/scripts/extract-preview-url.test.ts against the real output shapes.
#
# What it defends against, all of it observed in real output:
#
#   - CURSOR-CONTROL ESCAPES. Vercel redraws its progress line in place, so the
#     text carries \x1b[2K\x1b[1A\x1b[G sequences. Left in, they travel into
#     $GITHUB_OUTPUT and every consumer downstream.
#   - THE "Preview" LABEL. The status line reads `  Preview   https://...`, and
#     any whitespace-squashing (the old `tr -d ' '`) welds label to URL.
#   - THE INSPECT URL. `Inspect: https://vercel.com/...` is a dashboard link,
#     not a deployment. Matching any https:// can select it.
#
# The rule that makes all three harmless: match the URL itself with `grep -o`
# and a character class that cannot include an escape byte or a space, rather
# than matching the line that contains it.
#
# Exits non-zero if no well-formed *.vercel.app URL is present. A caller that
# gets a URL from this can trust it; a caller that gets nothing knows at once,
# instead of five minutes later in a curl loop.

set -euo pipefail

# Strip ANSI/cursor-control sequences first, so a URL that had one glued to its
# front is still recognisable. Belt and braces: `grep -o` below would exclude
# the escape bytes anyway.
url=$(
  sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' \
    | grep -oE 'https://[A-Za-z0-9._-]+\.vercel\.app' \
    | grep -vE '^https://vercel\.app$' \
    | tail -1 \
    || true
)

if [ -z "$url" ]; then
  echo "❌ No *.vercel.app preview URL found in deployment output" >&2
  exit 1
fi

printf '%s\n' "$url"
