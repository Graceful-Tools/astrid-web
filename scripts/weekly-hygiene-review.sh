#!/bin/zsh -l
#
# Weekly code + production hygiene review.
#
# Reviews the repo across five lenses (hygiene, duplication, security, performance,
# documentation) and files the findings as tasks on the Astrid Web To-do. Scheduled by
# scripts/launchd/cc.astrid.weekly-hygiene-review.plist; see
# docs/WEEKLY_HYGIENE_REVIEW.md.
#
#   ./scripts/weekly-hygiene-review.sh                # full run
#   ./scripts/weekly-hygiene-review.sh --setup-only   # refresh the worktree, file nothing
#
# The review runs against a throwaway detached worktree pinned to origin/main, so it never
# touches your working tree or current branch. It is read-only on code; its only side
# effect is filing Astrid tasks.

set -uo pipefail

SETUP_ONLY=0
[ "${1:-}" = "--setup-only" ] && SETUP_ONLY=1

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
WT="${REPO:h}/astrid-web-review"
PROMPT="$SCRIPT_DIR/weekly-hygiene-review.prompt.md"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
REVIEW_MODEL="${HYGIENE_REVIEW_MODEL:-opus}"
export PATH="/opt/homebrew/bin:$PATH"

# launchd hands us a cwd we may not be allowed to read, which breaks even `git -C`.
cd "$REPO" || { echo "✗ cannot enter $REPO"; exit 1; }

echo "════════ weekly hygiene review — $(date '+%Y-%m-%d %H:%M:%S %Z') ════════"

[ -f "$PROMPT" ] || { echo "✗ missing prompt file: $PROMPT"; exit 1; }
[ -x "$CLAUDE" ] || { echo "✗ claude not executable at $CLAUDE (set CLAUDE_BIN)"; exit 1; }
[ "$REPO" = "$WT" ] && { echo "✗ refusing to run: $REPO is the review worktree itself"; exit 1; }

# 1. Refresh the review worktree to origin/main.
git fetch origin main --quiet || { echo "✗ fetch failed"; exit 1; }

if [ ! -e "$WT/.git" ]; then
  echo "→ creating review worktree at $WT"
  git worktree add --detach "$WT" origin/main || { echo "✗ worktree add failed"; exit 1; }
fi

git -C "$WT" fetch origin main --quiet
git -C "$WT" checkout --detach --force origin/main --quiet || { echo "✗ checkout failed"; exit 1; }
# Drop anything a previous run left behind, but keep installed deps and the env symlink.
git -C "$WT" clean -qfd -e node_modules -e .env.local
echo "→ reviewing $(git -C "$WT" log -1 --format='%h %s')"

# 2. Credentials: reuse the primary checkout's .env.local (never copy secrets around).
ln -sfn "$REPO/.env.local" "$WT/.env.local"

# 3. Install deps only when the lockfile actually changed.
LOCK_HASH=$(shasum "$WT/package-lock.json" | cut -d' ' -f1)
STAMP="$WT/node_modules/.hygiene-lock-hash"
if [ ! -d "$WT/node_modules" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "→ npm ci (lockfile changed)"
  ( cd "$WT" && npm ci --silent ) || { echo "✗ npm ci failed"; exit 1; }
  echo "$LOCK_HASH" > "$STAMP"
else
  echo "→ deps up to date, skipping npm ci"
fi

if [ "$SETUP_ONLY" = "1" ]; then
  echo "→ --setup-only: worktree ready, skipping the review"
  exit 0
fi

# 4. Run the review.
cd "$WT" || exit 1
"$CLAUDE" -p "$(cat "$PROMPT")" \
  --model "$REVIEW_MODEL" \
  --permission-mode bypassPermissions
STATUS=$?

echo "──────── finished $(date '+%H:%M:%S') (exit $STATUS) ────────"
exit $STATUS
