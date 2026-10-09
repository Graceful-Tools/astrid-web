#!/bin/zsh -l
#
# fixall-loop.sh — one scheduled, unattended pass of /fixall on the WEB board.
#
# WHY THIS EXISTS (AWTD-971). Assigning a task to Claude Agent in Astrid starts
# nothing: in polling mode Astrid calls out to no one, by design
# (docs/AGENT_POLLING_MODE.md, after the 2026-08-23 retry storm). Something has
# to poll, and this repo had nothing — `.github/workflows/fixall.yml` is the
# COPILOT path, and astrid-ios had the only Claude loop. So every web /fixall
# to date has run because someone typed it.
#
# Ported from astrid-ios/scripts/fixall-loop.sh. The differences are all
# consequences of running IN the web checkout rather than beside it: tsx is
# local, the lock needs no cd, and the board is the web one.
#
# IT RUNS ON THE CLAUDE CODE CLI SUBSCRIPTION, NEVER THE ANTHROPIC API
# (Jon, 2026-09-19). `claude -p` is the whole runtime; no API key is read
# anywhere in this path, and --max-budget-usd is a CLI safety bound rather than
# metered spend. That is the entire point of polling mode: the subscription
# already covers the work, and the harness has the repo, the branches and the
# tests.
#
# launchd calls this every half hour through scripts/run-fixall-loop.mjs (the
# node shim exists for a TCC reason — read the top of that file before
# "simplifying" it). You can also run it by hand to test the guards:
#
#   npm run fixall:loop
#
# The last line is always exactly one RESULT: line, so a scheduler or a person
# skimming the log can tell what happened without reading it.
#
#   RESULT: OK      — a run happened
#   RESULT: SKIPPED — deliberately did nothing, and why
#   RESULT: FAILED  — tried and could not
#
# WHY A SKIP IS THE COMMON CASE. Every half hour is often, and most ticks have
# nothing to do or land while someone is already working the tree. A skip is the
# healthy outcome, not an error, so it exits 0 and says so in one line.
#
# Environment:
#   FIXALL_MODEL        model for the unattended run (default: opus)
#   FIXALL_MAX_MINUTES  watchdog, kills a wedged run (default: 75)
#   FIXALL_MAX_USD      CLI budget bound for one run (default: 10; empty = none)
#   FIXALL_LONG_RUN_WINDOW  local hours a LONG-RUN task may start (default: 22-6; "always")
#   FIXALL_LONG_MAX_USD budget bound for a LONG-RUN run (default: 50)
#   CLAUDE_BIN          path to the claude CLI (default: ~/.local/bin/claude)
#   FIXALL_FORCE=1      skip the dirty-tree/branch guard (testing only)

set -u
export PATH="/opt/homebrew/bin:$PATH"

REPO="${0:A:h:h}"
TSX="$REPO/node_modules/.bin/tsx"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
MODEL="${FIXALL_MODEL:-opus}"
# 75, not 50: on 2026-09-27 a run capped at ONE task (AWTD-1007) still hit a 50m
# watchdog. A killed run is now saved and harmless, but a task that never fits
# would be killed on every attempt.
MAX_MINUTES="${FIXALL_MAX_MINUTES:-75}"
MAX_USD="${FIXALL_MAX_USD-10}"
LONG_RUN_WINDOW="${FIXALL_LONG_RUN_WINDOW:-22-6}"
WEB_LIST_ID="a623f322-4c3c-49b5-8a94-d2d9f00c82ba"

echo "──────── fixall loop (web) $(date '+%Y-%m-%d %H:%M:%S') ────────"

cd "$REPO" || { echo "RESULT: FAILED — cannot enter $REPO"; exit 1; }

# Run-level news where Jon actually reads it. Per-task detail is already on the
# tasks as comments; this is only for what no task owns — a crash, a wedged run
# — which is exactly the case where the agent cannot report for itself.
post_to_list() {
  [ -x "$TSX" ] || return 0
  "$TSX" scripts/post-list-message.ts "$WEB_LIST_ID" "$1" \
    >/dev/null 2>&1 || echo "  (could not post to list chat)"
}

if [ ! -x "$TSX" ]; then
  echo "RESULT: FAILED — no tsx at $TSX (run npm ci)"
  exit 1
fi

# ── Guard 1: one session per working tree ────────────────────────────────────
# Cheap by design: no Claude session is started just to discover the tree is
# busy. Also backs off correctly when Jon is running /fixall interactively.
"$TSX" scripts/fixall-session.ts acquire --pid $$ --harness claude-code
LOCK_STATUS=$?
if [ "$LOCK_STATUS" -eq 2 ]; then
  echo "RESULT: SKIPPED — another live session holds this checkout"
  exit 0
elif [ "$LOCK_STATUS" -ne 0 ]; then
  echo "RESULT: FAILED — could not take the working-tree lock (exit $LOCK_STATUS)"
  exit 1
fi

release_lock() {
  "$TSX" scripts/fixall-session.ts release --pid $$ >/dev/null 2>&1
}
trap release_lock EXIT INT TERM

# THE LOCK IS HELD BY THIS SCRIPT, whose pid the agent cannot see. Inside
# `claude -p`, $PPID is the claude process — a different LIVE pid — so the
# agent's own acquire would return 2 and it would stop before reading the queue,
# blocked by its own launcher. .claude/commands/fixall.md checks this variable
# and skips the acquire when it is set. Remove one and the other is a silent
# no-op on every tick.
export ASTRID_FIXALL_LOCK_HELD=1
# One Ready task per run (fixall.md → "One task per scheduled run"). Four tasks
# with a ~10-minute predeploy each do not fit the 50m watchdog: on 2026-09-27 the
# 16:20 run was killed partway into its first task. The next tick takes the next.
export ASTRID_FIXALL_MAX_TASKS="${FIXALL_MAX_TASKS:-1}"

# ── Guard 2: never clobber work in progress ──────────────────────────────────
# /fixstuff takes no lock, so an interactive session editing files here is
# invisible to guard 1. This is the only thing between a 30-minute tick and
# uncommitted work.
#
# A MERGED BRANCH IS NOT WORK IN PROGRESS. On 2026-09-26 a session merged its
# branch and left the checkout on it — clean, identical to origin/main — and
# this guard skipped every tick for 9½ hours while Ready filled up. A clean HEAD
# already contained in origin/main has nothing to lose, so the loop goes back to
# main itself. Anything else (dirty, or commits origin/main lacks) is still left
# alone.
#
# A SKIP THAT NEVER ENDS IS AN OUTAGE. Skips exit 0 and read as healthy, so a
# stuck loop looked exactly like an idle one. STUCK_FILE records when the
# current run of skips began; past FIXALL_STUCK_ALERT_MINUTES the loop posts to
# the board chat, once, and the marker clears as soon as a tick gets through.
STUCK_DIR="$HOME/Library/Caches/astrid-fixall"
STUCK_FILE="$STUCK_DIR/stuck-web"
STUCK_ALERT_MINUTES="${FIXALL_STUCK_ALERT_MINUTES:-120}"

skip_guard2() {
  local reason="$1" now since
  mkdir -p "$STUCK_DIR"
  now=$(date +%s)
  [ -f "$STUCK_FILE" ] || echo "$now" > "$STUCK_FILE"
  since=$(head -1 "$STUCK_FILE")
  if [ $(( (now - since) / 60 )) -ge "$STUCK_ALERT_MINUTES" ] && ! grep -q '^alerted$' "$STUCK_FILE"; then
    post_to_list "**Scheduled /fixall (web) has been skipping for $(( (now - since) / 60 )) minutes** — $reason. Ready tasks will not be worked until the checkout at $REPO is clean and on main."
    echo "alerted" >> "$STUCK_FILE"
  fi
  echo "RESULT: SKIPPED — $reason"
  exit 0
}

if [ "${FIXALL_FORCE:-0}" != "1" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    skip_guard2 "working tree is dirty, leaving it alone"
  fi
  if [ "$BRANCH" != "main" ]; then
    if git fetch -q origin main 2>/dev/null && git merge-base --is-ancestor HEAD origin/main; then
      if git checkout -q main && git merge -q --ff-only origin/main; then
        echo "  returned to main from $BRANCH (already in origin/main)"
      else
        skip_guard2 "HEAD is on $BRANCH (merged) but could not return to main"
      fi
    else
      skip_guard2 "HEAD is on $BRANCH, not main, with commits origin/main lacks"
    fi
  else
    # UNPUSHED COMMITS ON MAIN ARE WORK IN PROGRESS TOO (AWTD-1095). On
    # 2026-10-05 an interactive session's tree was clean for a moment between
    # commits, with main ahead of origin, and the 07:53 tick started on it.
    git fetch -q origin main 2>/dev/null
    AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null)
    if [ -n "$AHEAD" ] && [ "$AHEAD" -gt 0 ]; then
      skip_guard2 "main has $AHEAD commit(s) origin/main lacks — someone's work in progress"
    fi
  fi
fi
rm -f "$STUCK_FILE"

# ── Run what is merged, not what someone last pulled by hand ─────────────────
# Nothing else updates this checkout. On 2026-09-27 a merged loop fix sat unused
# in astrid-ios until a human pulled it. The guards above have just confirmed a
# clean tree on main, so a fast-forward cannot clobber anything. If the loop
# script itself changed, exec the new version: same pid, so the lock is simply
# reacquired, and FIXALL_SELF_UPDATED stops it updating twice. A failed fetch
# (offline, auth) degrades to running the current checkout — it must not become
# a loop that never runs. fsmonitor off: a stuck daemon hung a pull here.
if [ "${FIXALL_FORCE:-0}" != "1" ] && [ "${FIXALL_SELF_UPDATED:-0}" != "1" ]; then
  BEFORE=$(git rev-parse HEAD)
  if GIT_TERMINAL_PROMPT=0 git -c core.fsmonitor=false fetch -q origin main 2>/dev/null \
     && git -c core.fsmonitor=false merge -q --ff-only origin/main 2>/dev/null; then
    AFTER=$(git rev-parse HEAD)
    if [ "$BEFORE" != "$AFTER" ]; then
      echo "  updated main $(git rev-parse --short "$BEFORE") → $(git rev-parse --short "$AFTER")"
      if ! git diff --quiet "$BEFORE" "$AFTER" -- scripts/fixall-loop.sh; then
        echo "  the loop changed — restarting on the new version"
        FIXALL_SELF_UPDATED=1 exec "$0" "$@"
      fi
    fi
  else
    echo "  ⚠️  could not fast-forward main to origin/main — running on $(git rev-parse --short HEAD)"
  fi
fi

# ── Doing must not be a dead end ─────────────────────────────────────────────
# Doing is "being worked right now", and the queue never takes it — so a claim
# whose session died sat there forever: on 2026-09-28 three did, each with its
# work on a pushed branch, while every tick said "not in Ready". A claim idle for
# FIXALL_STALE_DOING_MINUTES (default 180, well past the watchdog) is released
# back to Ready, naming its branch; a second release hands it back to a human.
# Before guard 3, so a released task counts as work for this very tick. Never
# fatal: a failed release leaves the task where it already was.
"$TSX" scripts/release-stuck-doing.ts --agent claude --list "$WEB_LIST_ID" \
  --stale-minutes "${FIXALL_STALE_DOING_MINUTES:-180}" --repo "$REPO" 2>&1 | sed 's/^/ /'

# ── Guard 3: is there actually any work? ─────────────────────────────────────
# THE expensive question, asked the cheap way. Without this a quiet tick still
# boots a whole session — CLAUDE.md, fixall.md, the MCP tool schemas — to call
# get_agent_queue once and find `empty: true`. A few HTTP requests answer the
# same question, and answer ALL of it — three things the run must act on, and
# until 2026-09-20 this guard checked only the first:
#
#   queue  — Ready ∩ (assigned to claude ∪ unassigned) ∩ due (the endpoint's
#            `empty`; --include-unassigned is the /fixall rule, docs/FIXALL_WORKFLOW.md)
#   inbox  — `attention`: comments and chat nobody answered (AWTD-963). The
#            guard skipped past two direct questions from Jon, "nothing queued".
#   lanes  — `--board web` runs the sweep as claude-code first: parked work
#            whose date arrived comes back to Ready, and RECHECK/REVIEW items
#            are work. Before this the sweep ran only INSIDE a session, and a
#            session needed a non-empty queue to start, so a parked task could
#            never wake the loop on its own.
#
# And it stays cheap in the other direction: an inbox or lane item wakes ONE
# run (scripts/agent-queue-status.ts keeps a seen-file), so something the
# agent chose not to answer cannot start a session every half hour.
#
# The seen-file write is the SECOND phase of waking. The preflight below runs
# with --no-write-seen and hands its keys back as a KEYS: line; the run's
# outcome records them. A finished run marks them seen. A run that crashes,
# is watchdog-killed, or exhausts its budget must not mute the items that
# woke it on the first failure — otherwise "one run per item" becomes "one
# attempt ever" — but it gets a strike (--mark-seen --failed), and a key out
# of strikes is muted like a finished one, so a run that keeps dying on the
# same item cannot wake a session every tick forever.
#
# Exit 1 means "could not tell" (network, auth) and must NOT be read as empty:
# a queue we cannot see is a reason to run and let the agent report properly,
# not a reason to skip quietly forever.
#
# The same call plans the run's LENGTH (AWTD-1041, scripts/lib/long-run.ts): a
# task flagged LONG-RUN is deferred outside the window — so a queue holding
# only that one is idle this tick — and taken first inside it. "Size the run",
# below, applies the answer.
QUEUE_OUT=$("$TSX" scripts/agent-queue-status.ts --agent claude --list "$WEB_LIST_ID" --board web --include-unassigned --no-write-seen --long-run-window "$LONG_RUN_WINDOW" --default-minutes "$MAX_MINUTES" --max-tasks "$ASTRID_FIXALL_MAX_TASKS" 2>&1)
QUEUE_STATUS=$?
QUEUE_LINES=$(echo "$QUEUE_OUT" | grep -E '^(QUEUE|LANES|SEEN|RUN):')
QUEUE_KEYS=$(echo "$QUEUE_OUT" | sed -n 's/^KEYS: //p' | head -1)
echo "${QUEUE_LINES:-QUEUE: no verdict}" | sed 's/^/  /'
if [ "$QUEUE_STATUS" -eq 3 ]; then
  echo "RESULT: SKIPPED — nothing to do for claude (no Ready task, no new comment, no lane work)"
  exit 0
fi

if [ ! -x "$CLAUDE" ]; then
  echo "RESULT: FAILED — no claude CLI at $CLAUDE (set CLAUDE_BIN)"
  exit 1
fi

# ── Size the run (AWTD-1041) ─────────────────────────────────────────────────
# 75 minutes fits one ordinary task. A task flagged LONG-RUN in its description
# asks for up to 8 hours, and the preflight has already decided whether this
# tick may start it. Apply that: the watchdog and budget for the task it chose,
# and the task ids for /fixall, which takes RUN-TASK first and never takes a
# deferred one — a deferred long task under a 75m watchdog is the kill this
# exists to prevent. A missing or malformed plan leaves the defaults alone.
RUN_MINUTES=$(echo "$QUEUE_OUT" | sed -n 's/^RUN-MINUTES: \([0-9][0-9]*\)$/\1/p' | head -1)
[ -n "$RUN_MINUTES" ] && MAX_MINUTES="$RUN_MINUTES"
if echo "$QUEUE_OUT" | grep -q '^RUN-LONG: 1$' && [ -n "$MAX_USD" ]; then
  MAX_USD="${FIXALL_LONG_MAX_USD:-50}"
fi
export ASTRID_FIXALL_NEXT_TASK=$(echo "$QUEUE_OUT" | sed -n 's/^RUN-TASK: //p' | head -1)
export ASTRID_FIXALL_DEFER_TASKS=$(echo "$QUEUE_OUT" | sed -n 's/^RUN-DEFER: //p' | head -1)

# ── Can this machine CALL the board, and PUBLISH what it finishes? ───────────
# WARNS, never skips (AWTD-975). .claude/settings.local.json is gitignored, so
# a fresh checkout inherits none of the mcp__astrid__* grants and every board
# call is denied — with no terminal to grant them in. The run still works: it
# falls back to the OAuth scripts. What it loses is `attention`, the inbox that
# arrives only on get_agent_queue (AWTD-963), so it goes deaf while still
# logging RESULT: OK. That silence is the bug; this is the noise.
#
# Since AWTD-978 the same check also reports any `ask`/`deny` entry gating the
# push this run ends with — the other way a scheduled run fails quietly, by
# finishing its work and leaving it on local `main` where nobody can review it.
# Both are the same shape: a permission a `-p` session cannot be asked about.
#
# Not a guard, because degraded beats absent: one line in a gitignored file must
# not turn into a loop that never runs. The checker prints its own remedy for
# whichever problem it found — do not hardcode one here, it now reports two.
if ! PERMISSION_OUT=$("$TSX" scripts/check-board-permissions.ts 2>&1); then
  echo "  ⚠️  permissions on this machine will degrade this run:"
  echo "$PERMISSION_OUT" | sed 's/^/     /'
fi

# ── The run ──────────────────────────────────────────────────────────────────
# Two bounds, because a run goes wrong in two different ways.
#
# The watchdog catches one that HANGS. launchd will not start a second copy of a
# label while the first is alive, so one wedged run silently swallows every
# later tick until someone notices. macOS ships no `timeout`, hence the subshell.
#
# The budget catches one that stays BUSY — a task it cannot finish, retried
# until the clock runs out — which the watchdog would not stop for the whole window.
# --max-budget-usd only works with -p, which is the mode this always runs in.
BUDGET_ARGS=()
[ -n "$MAX_USD" ] && BUDGET_ARGS=(--max-budget-usd "$MAX_USD")

# Every task this run claims is recorded here (scripts/claim-fixall-task.ts), so
# the ones it leaves in Doing can be released after it — exactly, no heuristic.
CLAIMS_FILE=$(mktemp -t fixall-web-claims)
export ASTRID_FIXALL_CLAIMS_FILE="$CLAIMS_FILE"

echo "→ /fixall ($MODEL, watchdog ${MAX_MINUTES}m${MAX_USD:+, cap \$$MAX_USD})"
"$CLAUDE" -p "/fixall" \
  --model "$MODEL" \
  --permission-mode "${FIXALL_PERMISSION_MODE:-acceptEdits}" \
  "${BUDGET_ARGS[@]}" &
CLAUDE_PID=$!

( sleep $((MAX_MINUTES * 60)); kill -TERM "$CLAUDE_PID" 2>/dev/null ) &
WATCHDOG_PID=$!

wait "$CLAUDE_PID"
STATUS=$?
kill "$WATCHDOG_PID" 2>/dev/null

# ── Leave the checkout where the next tick can use it ────────────────────────
# fixall.md works each task on its own branch and merges back at the end. A run
# the watchdog kills never gets to the end: on 2026-09-26 one committed AWTD-1008
# on fix/fixall-claim-windows-board, was killed, and left HEAD there — unpushed,
# so nobody could see it, and unmerged, so guard 2 rightly refused every later
# tick. This wrapper holds the lock and the session that made the branch is
# gone, so it is the one place that may move HEAD: push the branch so the work
# is reviewable, then go back to main.
#
# UNCOMMITTED work is saved the same way, as a WIP commit on a branch. Leaving it
# "for a human" wedged the loop twice on 2026-09-27 (AWTD-1024 at 08:20, AWTD-1025
# at 16:20): guard 2 rightly refuses a dirty tree, so every later tick skipped
# while Ready work waited. The commit is never on main — a run that dirtied main
# itself gets a wip/ branch — and it is marked UNFINISHED so nobody ships it.
# --no-verify because the work is by definition unverified; the pre-commit hook
# would refuse it and put us back where we started.
#
# BUT ONLY ON A TASK BRANCH (AWTD-1095). Guard 2 started the run on a clean
# main, so a task branch is the run's own. Changes on MAIN could be anyone's: on
# 2026-10-05 an interactive session was editing main during a tick, and this
# block committed its edits to a wip/ branch and checked out main — removing
# them from under it. So main is only SNAPSHOTTED: the commit is built with a
# temporary index and pushed, and HEAD, the index and the files are left exactly
# as they were. The next tick then skips on the dirty tree, and guard 2's stuck
# alert says so — losing nobody's work is worth a skipped tick.
SAVED_BRANCH=""
END_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -n "$(git status --porcelain 2>/dev/null)" ] && { [ "$END_BRANCH" = "main" ] || [ "$END_BRANCH" = "HEAD" ]; }; then
  SNAP_BRANCH="wip/fixall-web-$(date +%Y%m%d-%H%M%S)"
  SNAP_INDEX=$(mktemp -t fixall-web-index)
  # Start from the real index so staged work is in the snapshot; a missing
  # index must be a missing file, since git reads an empty one as corrupt.
  cp "$(git rev-parse --git-path index)" "$SNAP_INDEX" 2>/dev/null || rm -f "$SNAP_INDEX"
  if GIT_INDEX_FILE="$SNAP_INDEX" git add -A \
     && SNAP_TREE=$(GIT_INDEX_FILE="$SNAP_INDEX" git write-tree) \
     && SNAP_COMMIT=$(git commit-tree "$SNAP_TREE" -p HEAD -m "wip: uncommitted changes on $END_BRANCH after a scheduled /fixall run — UNFINISHED, UNVERIFIED

Snapshotted by scripts/fixall-loop.sh (claude exit $STATUS). They may be the
run's or another session's, so the checkout was left exactly as it was; this
commit is only a copy. Predeploy has not been run on this. Do not ship it.") \
     && git branch "$SNAP_BRANCH" "$SNAP_COMMIT" \
     && git push -q origin "$SNAP_BRANCH" 2>/dev/null; then
    SAVED_BRANCH="$SNAP_BRANCH"
    echo "  $END_BRANCH has uncommitted changes — left them in place, copy pushed to $SNAP_BRANCH"
    post_to_list "**Scheduled /fixall (web) left uncommitted changes on $END_BRANCH where they are** — they may be another session's, so the checkout was not touched. A copy is on \`$SNAP_BRANCH\`. Ticks will skip until the tree is clean."
  else
    echo "  ⚠️  $END_BRANCH has uncommitted changes and no copy could be pushed — left them in place"
  fi
  rm -f "$SNAP_INDEX"
elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  if git add -A && git commit -q --no-verify -m "wip: scheduled /fixall run ended mid-task — UNFINISHED, UNVERIFIED

Saved by scripts/fixall-loop.sh (claude exit $STATUS) so the checkout can return
to main. Predeploy has not been run on this. Continue from here; do not ship it."; then
    SAVED_BRANCH="$END_BRANCH"
    echo "  run left uncommitted changes — saved as a WIP commit on $END_BRANCH"
  else
    echo "  ⚠️  run left $END_BRANCH with uncommitted changes and they could not be committed — leaving it for a human"
  fi
fi
if [ "$END_BRANCH" != "main" ] && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  if [ -n "$SAVED_BRANCH" ]; then
    post_to_list "**Scheduled /fixall (web) saved unfinished work on \`$SAVED_BRANCH\`** — the run ended mid-task, so it is a WIP commit, not verified. The loop has gone back to main; pick the task up from that branch."
  fi
  if git push -q -u origin "$END_BRANCH" 2>/dev/null; then
    echo "  run left $END_BRANCH — pushed it to origin for review"
  else
    echo "  ⚠️  run left $END_BRANCH and it could not be pushed"
    post_to_list "**Scheduled /fixall (web) left unpushed work on \`$END_BRANCH\`** — the push failed. The branch is still in $REPO; the loop has gone back to main."
  fi
  git checkout -q main && echo "  returned to main from $END_BRANCH"
fi

# A completed task's branch gets a PR. `gh` is denied inside the session, so on
# 2026-09-29 four finished tasks sat on pushed branches nobody was asked to
# review — the board said complete, main had none of it. The runner can run gh.
PR_OUT=$("$TSX" scripts/open-fixall-prs.ts --claims-file "$CLAIMS_FILE" --repo "$REPO" 2>&1)
PR_STATUS=$?
[ -n "$PR_OUT" ] && echo "$PR_OUT" | sed 's/^/ /'
if [ "$PR_STATUS" -eq 3 ]; then
  post_to_list "**Scheduled /fixall (web) finished work but could not open its PR** — open it by hand so it gets reviewed:

$(echo "$PR_OUT" | grep 'PR: FAILED')"
fi

# A finished task is completed, a blocked one is in Waiting: anything this run
# claimed that is STILL in Doing was abandoned mid-task. Release it now, after
# the branch above is pushed, so its comment can point at the work.
"$TSX" scripts/release-stuck-doing.ts --agent claude --claims-file "$CLAIMS_FILE" --repo "$REPO" 2>&1 | sed 's/^/ /'
rm -f "$CLAIMS_FILE"

# Phase two of waking, before the RESULT line so that line stays last (the
# header promises it). A finished run had its chance at the preflight's items:
# they are marked seen and will not wake another run. A failed run gives them
# a strike instead; scripts/lib/wake-keys.ts holds the strike limit.
if [ -n "$QUEUE_KEYS" ]; then
  if [ "$STATUS" -eq 0 ]; then
    "$TSX" scripts/agent-queue-status.ts --agent claude --list "$WEB_LIST_ID" --mark-seen --seen-keys "$QUEUE_KEYS" 2>&1 | sed 's/^/  /'
  else
    "$TSX" scripts/agent-queue-status.ts --agent claude --list "$WEB_LIST_ID" --mark-seen --failed --seen-keys "$QUEUE_KEYS" 2>&1 | sed 's/^/  /'
  fi
fi

if [ "$STATUS" -eq 0 ]; then
  echo "RESULT: OK — run finished (see the tasks for what changed)"
  exit 0
fi

# A run that died cannot write its own completion comment, and this is precisely
# the outcome worth hearing about, so the wrapper says it on the board itself.
if [ "$STATUS" -ge 128 ]; then
  REASON="killed after ${MAX_MINUTES}m watchdog timeout (signal $((STATUS - 128)))"
else
  REASON="claude exited $STATUS"
fi
if [ -n "$SAVED_BRANCH" ]; then
  SAVED_NOTE="Its unfinished work is saved on \`$SAVED_BRANCH\` (WIP, unverified)."
else
  SAVED_NOTE="Nothing was pushed by this run."
fi
post_to_list "**Scheduled /fixall (web) did not finish** — $REASON. $SAVED_NOTE Log: ~/Library/Logs/astrid-fixall-web.log"
echo "RESULT: FAILED — $REASON"
exit 1
