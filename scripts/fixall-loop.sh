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
#   FIXALL_MAX_MINUTES  watchdog, kills a wedged run (default: 50)
#   FIXALL_MAX_USD      CLI budget bound for one run (default: 10; empty = none)
#   CLAUDE_BIN          path to the claude CLI (default: ~/.local/bin/claude)
#   FIXALL_FORCE=1      skip the dirty-tree/branch guard (testing only)

set -u
export PATH="/opt/homebrew/bin:$PATH"

REPO="${0:A:h:h}"
TSX="$REPO/node_modules/.bin/tsx"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
MODEL="${FIXALL_MODEL:-opus}"
MAX_MINUTES="${FIXALL_MAX_MINUTES:-50}"
MAX_USD="${FIXALL_MAX_USD-10}"
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
  fi
fi
rm -f "$STUCK_FILE"

# ── Guard 3: is there actually any work? ─────────────────────────────────────
# THE expensive question, asked the cheap way. Without this a quiet tick still
# boots a whole session — CLAUDE.md, fixall.md, the MCP tool schemas — to call
# get_agent_queue once and find `empty: true`. A few HTTP requests answer the
# same question, and answer ALL of it — three things the run must act on, and
# until 2026-09-20 this guard checked only the first:
#
#   queue  — Ready ∩ assigned to claude ∩ due (the endpoint's `empty`)
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
QUEUE_OUT=$("$TSX" scripts/agent-queue-status.ts --agent claude --list "$WEB_LIST_ID" --board web --no-write-seen 2>&1)
QUEUE_STATUS=$?
QUEUE_LINES=$(echo "$QUEUE_OUT" | grep -E '^(QUEUE|LANES|SEEN):')
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
# until the clock runs out — which the watchdog would not stop for 50 minutes.
# --max-budget-usd only works with -p, which is the mode this always runs in.
BUDGET_ARGS=()
[ -n "$MAX_USD" ] && BUDGET_ARGS=(--max-budget-usd "$MAX_USD")

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
post_to_list "**Scheduled /fixall (web) did not finish** — $REASON. Nothing was pushed by this run. Log: ~/Library/Logs/astrid-fixall-web.log"
echo "RESULT: FAILED — $REASON"
exit 1
