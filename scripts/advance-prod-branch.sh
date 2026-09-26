#!/usr/bin/env bash
#
# advance-prod-branch.sh <sha> [branch] [tag-prefix]
#
# Points `prod` at the commit production is now serving, and tags it.
#
# WHY. Deploys are manual (CLAUDE.md rule 1), so `main` routinely runs ahead of
# what is live, and "what is live" used to mean curling /api/health for a SHA.
# With this branch it is a ref:
#
#   git log origin/prod..origin/main            what the next deploy would ship
#   git diff origin/prod origin/main -- prisma/ the migrations it would apply
#
# The branch says what is live NOW; the tags (<prefix>-<YYYYMMDD-HHMMSS UTC>-<sha7>) say
# what was live WHEN. The same idea runs in astrid-ios as `ios-prod` / `mac-prod`.
#
# ONLY THE DEPLOY MOVES IT. production-deployment.yml calls this after the
# health check has confirmed production serves <sha>. Nobody commits to prod.
#
# It follows production, including backwards. A rollback, or a deploy
# dispatched from another branch, is not a fast-forward — the branch still
# moves, because a `prod` that disagrees with production is worse than none,
# and the run gets a ::warning:: so the non-linear move is on the record.

set -euo pipefail

SHA="${1:?usage: advance-prod-branch.sh <sha> [branch] [tag-prefix]}"
BRANCH="${2:-prod}"
PREFIX="${3:-prod}"

SHA=$(git rev-parse --verify "$SHA^{commit}")
git fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null || true

if OLD=$(git rev-parse -q --verify "refs/remotes/origin/$BRANCH"); then
  if [ "$OLD" = "$SHA" ]; then
    echo "$BRANCH is already at ${SHA:0:7} — nothing to move"
    exit 0
  fi
  if git merge-base --is-ancestor "$OLD" "$SHA"; then
    echo "$BRANCH: ${OLD:0:7} → ${SHA:0:7} (fast-forward, $(git rev-list --count "$OLD..$SHA") commits)"
  else
    echo "::warning::$BRANCH moved ${OLD:0:7} → ${SHA:0:7}, which is NOT a fast-forward (a rollback, or a deploy from another branch)"
  fi
else
  echo "$BRANCH does not exist yet — creating it at ${SHA:0:7}"
fi

TAG="$PREFIX-$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
# The name carries the SHA, so an existing tag of this name is this commit.
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git tag "$TAG" "$SHA"
git push -q origin "+$SHA:refs/heads/$BRANCH" "refs/tags/$TAG"
echo "tagged $TAG"
