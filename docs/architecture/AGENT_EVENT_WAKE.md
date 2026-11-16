# Opt-in event-driven wake for polling agents (AWTD-1556)

**Status: approved by Jon 2026-11-14 (decisions below); implemented, inert until enrolled.** Polling
stays the reconciliation path: a wake that never arrives costs latency, never work.

Code: `lib/agent-wake.ts` (hooks, coalescing, delivery), job kind `agent-wake` in `lib/jobs/kinds.ts`,
hooks in `services/task-create-broadcast.ts` and `services/task-update-broadcast.ts` (every task create and update) and `lib/comments/post-comment-side-effects.ts`,
trigger and latency step in `.github/workflows/agent-run.yml`. Tests: `tests/lib/agent-wake.test.ts`,
`tests/rules/cloud-agent-lifecycle.test.ts`, `tests/api/task-write-path-parity.test.ts`.

## The problem

A polling agent learns about work by asking. The generated loops ask every 30 minutes, and the
cloud worker (`.github/workflows/agent-run.yml`) runs at `:05` and `:35`, so a Ready task or a
human reply can wait up to ~30 minutes before anything starts. A CLI run directly starts in
seconds. Webhook-mode agents are already told about work (`lib/webhooks/task-assignment-notifier.ts`,
`lib/webhooks/comment-notifier.ts`); polling-mode agents, which is how Claude, Codex and Copilot
work this board, are not.

## What already exists (no new infrastructure needed)

| Piece | Where | What it gives us |
|---|---|---|
| Runnable verdict | `lib/agent-queue.ts` (`runnable`, AWTD-1560) | one definition of "there is work": Ready, or an unanswered reply; never `incomplete` alone |
| Atomic claim | `app/api/v1/tasks/[id]/claim-fixall/route.ts` (AWTD-1555) | of two starters, exactly one owns the task |
| Durable job queue | `lib/jobs/queue.ts` (`Job` table, AWTD-1460) | `dedupeKey` (a second enqueue is a no-op), retries with backoff, dead-lettering; drained in `after()` right after each enqueue and by the minute cron, so a job starts within seconds |
| Realtime bus | `lib/realtime/bus.ts` (AWTD-1459) | in-process/Redis fan-out to SSE subscribers, which is what the SDK channel listens on |
| Event hooks | `notifyTaskAssignment`, `notifyCommentOnAssignedTask` | the two moments work becomes runnable are already detected server-side |
| A door into the worker | `agent-run.yml` already accepts `repository_dispatch` (`agent-run-next`, used for chaining) | a server-sent dispatch starts the same worker the cron starts |

The `Job` table means AWTD-1460's migration has already shipped: **this design needs no
migration.**

## Proposed design

**Event sources.** Two moments, both already detected:
1. A task becomes runnable for an enrolled agent: it enters Ready on an enrolled board, assigned to
   that agent or unassigned.
2. A human comment reaches an enrolled agent (the same predicate as `attention` in the queue).

**Wake job.** At either moment, `enqueueJob('agent-wake', payload, { dedupeKey })` with
`dedupeKey = agent-wake:<board>:<mailbox>:<window>`, where `window` is the event time divided
into 30-second slots (`WAKE_COALESCE_MS`). This is Jon's coalescing decision: one wake per
(board, agent) per window, so a bulk move, a retried request, a double save or a replay all
stay one wake. An unassigned Ready task uses the mailbox `any`. Only agents in **polling** mode
are woken; webhook and api agents are already told by their notifiers, and `off` means nothing
should start them.

**Delivery, first canary: `repository_dispatch` to the board's repository.** The job handler
looks up the GitHub App's installation on the repository (`GET /repos/{owner}/{repo}/installation`
with the App from `lib/github/app.ts`), mints its installation token, and sends
`repository_dispatch` with a new type, `astrid-wake`, carrying only
`{ task_id, mailbox, reason, event_at }`, never task text. The repository is the one named in the
enrollment entry (`boardId=owner/repo`), else the board's connected repository
(`TaskList.githubRepositoryId`). The App needs Contents write on that repository. `agent-run.yml` adds `astrid-wake` to its
`repository_dispatch.types`. The run reads the queue and claims before working, exactly as a
cron run does, so the payload is a hint, not an instruction: a forged or stale dispatch can
only start a run that finds nothing. The run job skips a wake whose mailbox is neither this
worker's (`claude`) nor `any`.

**Later, for SDK/self-hosted agents: SSE.** The same job publishes an `agent.wake` event on the
realtime bus for the agent's channel. The SDK channel (AWTD-1565) treats it as "reconcile now".
Not in the first canary.

**Enrollment.** Opt-in per board, by an env list (`ASTRID_AGENT_WAKE_LISTS`, the same shape as
the retired `ASTRID_AGENT_CLAIM_REQUIRED_LISTS`, now the `agentClaimRequired` list setting) plus a master switch `ASTRID_AGENT_WAKE=on`. Off by default:
with either unset, no job is enqueued and nothing changes.

## Idempotency and "exactly once"

- **At most one wake per (board, agent) per 30 seconds:** the job's unique `dedupeKey`, which
  also makes a replayed event a no-op.
- **One start per task:** the atomic claim. Two wakes, or a wake and a cron run, race to claim;
  exactly one wins and the other finds nothing.
- **One answer per reply:** the wake does not mark anything seen; the run's own seen set, keyed
  by the reply's comment id (AWTD-1560), decides whether a reply is still unanswered.

## Failure modes

| Failure | Result | Why it is safe |
|---|---|---|
| Job never enqueued (crash before commit) | Next cron run finds the work | polling is the reconciliation path |
| Dispatch fails (token, rate limit, GitHub down) | Job retries with backoff, then dead-letters | the cron still runs; nothing is lost |
| Duplicate dispatch | Second run's claim conflicts, it exits | claim is atomic |
| Dispatch for work already done | Run reads an empty queue and exits | payload is a hint, not an instruction |
| Wake storm (bulk move of 100 tasks to Ready) | 1 job, 1 dispatch | coalesced: `dedupeKey` per (board, mailbox, 30-second window); GitHub's concurrency group then holds at most one pending run |
| Hook fails (database blip) | No wake | the hooks never throw into the task or comment write; the next poll finds the work |
| Switch turned off with wakes queued | Queued wakes are dropped | the handler re-checks enrollment before sending |
| Forged `repository_dispatch` | A run that reads the queue and finds nothing | the queue and claim are authorized server-side |

## Measurement

Wake latency end to end, p50 and p95: the event's timestamp to the run's first queue read. The
baseline is the cron: about 15 minutes mean and 30 minutes worst case on paper, and worse in
practice, since GitHub created only about one in ten scheduled runs from 10-29 to 10-31.

**What is recorded.** Every `astrid-wake` run writes `.agent-output/wake-latency.json`
(`event_at`, `queue_read_at`, `latency_seconds`, `reason`, `mailbox`, `work`) into its
`agent-run-claude-code-<run id>` artifact, and one line to the run summary. `event_at` is stamped
by the server when the job is queued, so the figure includes the queue, the GitHub API call,
runner start-up and agent setup. The claim follows within seconds of the queue read.

**How to compute p50/p95 for a canary week** (needs production enrollment, so it is not done yet):

```bash
mkdir -p /tmp/wake && cd /tmp/wake
gh run list --repo Graceful-Tools/astrid-web --workflow agent-run.yml --event repository_dispatch \
  --created ">=2026-11-15" --limit 500 --json databaseId --jq '.[].databaseId' |
while read id; do
  gh run download "$id" --repo Graceful-Tools/astrid-web -p 'agent-run-*' -D "run-$id" 2>/dev/null || true
done
cat run-*/*/.agent-output/wake-latency.json | jq -s '
  map(.latency_seconds | select(. != null)) | sort as $l | ($l | length) as $n |
  {runs: $n, p50: $l[($n * 0.5 | floor)], p95: $l[(($n * 0.95 | ceil) - 1)]}'
```

`repository_dispatch` also matches chain runs (`agent-run-next`), which write no latency file,
so they drop out. For the baseline, the same artifacts from scheduled runs give the time from a
task's Ready event to the run that claimed it; or compare against the cron's 15/30-minute
figures. Watch alongside it: dead-lettered `agent-wake` jobs (`Job` rows with `deadAt` set),
claim conflicts (expected, harmless) and duplicate starts (should be zero). The benchmark
harness (AWTD-1551) can reuse the numbers.

## How to enable

Two production env vars, both required (no migration, no deploy of new code beyond this one):

- `ASTRID_AGENT_WAKE=on`
- `ASTRID_AGENT_WAKE_LISTS=a623f322-4c3c-49b5-8a94-d2d9f00c82ba` (this board already has
  `Graceful-Tools/astrid-web` as its connected repository; an entry can name another as
  `boardId=owner/repo`)

`agent-run.yml` must be on `main` with the `astrid-wake` trigger (repository_dispatch runs the
default branch's workflow), and the GitHub App must be installed on the repository with Contents
write.

## Rollout and rollback

1. Ship the job kind and handler with `ASTRID_AGENT_WAKE` unset: inert. (This change.)
2. Enroll this board only (`a623f322-…`), master switch on, for a week. Watch latency, duplicate
   claims (should be zero starts, some conflicts), and dead-letters.
3. Widen if clean.

Rollback is unsetting either variable: no job is enqueued, and the worker falls back to its cron.
No schema change at any step.

## Decisions (Jon, 2026-11-14)

All three went with the recommendation, and no migration.

1. **First canary delivery:** `repository_dispatch` to `agent-run.yml` (recommended; that is how
   this board's agents run) vs SSE for SDK hosts first vs both at once.
2. **Wake storms:** coalesce to one pending wake per board+mailbox (recommended) vs one wake per
   task.
3. **Enrollment:** env list per board (recommended; the same as claim enrollment) vs a per-board
   setting in the list settings UI (needs UI work, no migration).
