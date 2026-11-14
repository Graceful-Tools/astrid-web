# Opt-in event-driven wake for polling agents (AWTD-1556)

**Status: proposal for Jon's approval. No code yet.** Polling stays the reconciliation path in
every design below: a wake that never arrives costs latency, never work.

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
`dedupeKey = wake:<board>:<mailbox>:<taskId>:<eventId>`, where `eventId` is the status-change
timestamp or the comment id. Enqueueing twice for the same event is a no-op, which is how a
retried request, a double save or a webhook replay stays one wake.

**Delivery, first canary: `repository_dispatch` to the board's repository.** The job handler
mints a GitHub App installation token (`lib/github/installation-access.ts`) for the board's
connected repository and sends `repository_dispatch` with a new type, `astrid-wake`, carrying
only `{ taskId, mailbox, reason }`, never task text. `agent-run.yml` adds `astrid-wake` to its
`repository_dispatch.types`. The run reads the queue and claims before working, exactly as a
cron run does, so the payload is a hint, not an instruction: a forged or stale dispatch can
only start a run that finds nothing.

**Later, for SDK/self-hosted agents: SSE.** The same job publishes an `agent.wake` event on the
realtime bus for the agent's channel. The SDK channel (AWTD-1565) treats it as "reconcile now".
Not in the first canary.

**Enrollment.** Opt-in per board, by an env list (`ASTRID_AGENT_WAKE_LISTS`, the same shape as
`ASTRID_AGENT_CLAIM_REQUIRED_LISTS`) plus a master switch `ASTRID_AGENT_WAKE=on`. Off by default:
with either unset, no job is enqueued and nothing changes.

## Idempotency and "exactly once"

- **One wake per event:** the job's unique `dedupeKey`.
- **One start per task:** the atomic claim. Two wakes, or a wake and a cron run, race to claim;
  exactly one wins and the other finds nothing.
- **One wake per reply:** the reply's comment id is its event id, the same key the generated
  gates' seen set uses (AWTD-1560).

## Failure modes

| Failure | Result | Why it is safe |
|---|---|---|
| Job never enqueued (crash before commit) | Next cron run finds the work | polling is the reconciliation path |
| Dispatch fails (token, rate limit, GitHub down) | Job retries with backoff, then dead-letters | the cron still runs; nothing is lost |
| Duplicate dispatch | Second run's claim conflicts, it exits | claim is atomic |
| Dispatch for work already done | Run reads an empty queue and exits | payload is a hint, not an instruction |
| Wake storm (bulk move of 100 tasks to Ready) | 100 jobs, 100 dispatches | **needs a cap**: coalesce per board, at most one pending wake per board+mailbox at a time (`dedupeKey` per board while a run is pending) |
| Forged `repository_dispatch` | A run that reads the queue and finds nothing | the queue and claim are authorized server-side |

## Measurement

Wake latency end to end, p50 and p95: the event's timestamp to the run's first queue read, and to
the claim. Baseline is the cron (~15 min mean, ~30 min worst case). Recorded per canary run in
the job's result and summarized in the canary report. The benchmark harness (AWTD-1551) can
reuse the numbers.

## Rollout and rollback

1. Ship the job kind and handler with `ASTRID_AGENT_WAKE` unset: inert.
2. Enroll this board only (`a623f322-…`), master switch on, for a week. Watch latency, duplicate
   claims (should be zero starts, some conflicts), and dead-letters.
3. Widen if clean.

Rollback is unsetting either variable: no job is enqueued, and the worker falls back to its cron.
No schema change at any step.

## Decisions for Jon

1. **First canary delivery:** `repository_dispatch` to `agent-run.yml` (recommended; that is how
   this board's agents run) vs SSE for SDK hosts first vs both at once.
2. **Wake storms:** coalesce to one pending wake per board+mailbox (recommended) vs one wake per
   task.
3. **Enrollment:** env list per board (recommended; the same as claim enrollment) vs a per-board
   setting in the list settings UI (needs UI work, no migration).
