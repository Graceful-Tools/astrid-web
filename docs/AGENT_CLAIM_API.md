# Agent task claim API

`POST /api/v1/tasks/:id/claim` gives agent harnesses atomic ownership of a task, on any
board. Since AWTD-1688 it is on by default: no env flag, no board allowlist. Every claim
carries a **lease** that its holder renews with a **heartbeat**. When the lease runs out,
the task goes back to Ready.

The request must use an authenticated credential that may write the task.

- **An agent's own credential** (agent consent token, agent-bound static token,
  agent-owned client) acts as that agent. An optional `agentMailbox` confirms the bound
  mailbox's local part; a different mailbox is rejected.
- **A person's credential with no agent binding** names the agent it claims for with
  `agentMailbox`. This covers a client-credentials token and the stdio MCP server run
  on a client id and secret. The named account must be an active agent of this brand,
  and the caller must be allowed to put that agent on the task. That is the same rule
  as assigning an agent (`services/assignee-authorization.ts`), so naming an agent here
  grants nothing a task update would refuse. A browser session cannot claim as an agent.

```json
{ "action": "claim", "agentMailbox": "codex", "leaseSeconds": 900 }
```

`action` is `claim`, `resume`, `release`, or `heartbeat`. `leaseSeconds` is optional, a
whole number from 60 to 3600, and is accepted on `claim` and `heartbeat` only. The
default is 900 (15 minutes).

| Action | Transition | Successful outcome |
|---|---|---|
| `claim` | An incomplete Ready task becomes Doing, assigned to the agent, with a lease held by the agent. The status, assignment, and task-write access are rechecked in the conditional update. | `claimed` |
| `resume` | Does not change the task. Confirms an incomplete Doing task is already assigned to this agent. | `already_yours` |
| `heartbeat` | Renews the lease on an incomplete Doing task assigned to this agent, whose lease is this agent's (or which has none). `updatedAt` is left as it was: a heartbeat is not an edit. | `renewed` |
| `release` | An incomplete Doing task owned by this agent returns to Ready, this agent is removed from the assignee list, and the lease is cleared. Any remaining assignee becomes primary. | `released` |

These writes go to the task directly, like `/claim-fixall`. They do not add the usual
status or assignee system comment, and they do not publish the task-update broadcast.

Every response has an `outcome` and a task snapshot: `id`, `statusRole`, `completed`,
`assigneeId`, `assigneeIds`, `updatedAt`, and `claimLeaseExpiresAt`. The task is `null`
when the outcome is `not_found` or `forbidden`.

| Outcome | HTTP status | Meaning |
|---|---:|---|
| `claimed`, `already_yours`, `released`, `renewed` | 200 | The action succeeded or was already satisfied. |
| `conflict` | 409 | Another agent owns the claim, or the task changed before the atomic update. |
| `not_ready` | 409 | The task is completed or is not in the state this action needs. On `heartbeat`, this means the claim is gone, so stop work. |
| `not_found` | 404 | No task has this id. |
| `forbidden` | 403 | The caller cannot write the task or act as that agent. |
| `binding_denied` | 403/409 | A bound board refused the claim (AWTD-1669). |

Malformed actions or request bodies return `400`.

## Leases

A claim sets three nullable columns on the task: `claimLeaseExpiresAt`,
`claimHeartbeatAt`, and `claimHolderId`. Every five minutes, the existing
`/api/cron/waiting-settle` cron runs `services/agent-claim-lease.service.ts`. That service
reads each task whose lease has passed and acts on it as follows:

- **The holder still has it in Doing:** the task goes back to Ready, the lease is cleared,
  and a system comment records the last heartbeat and when the lease ran out. On an
  enrolled board (below) the holder is unassigned, so any agent can claim the task again.
  On any other board the assignment stays, as `scripts/lib/doing-release.ts` keeps it, so
  the same agent's queue picks the task up on its next run.
- **The task moved on** (completed, moved to another lane, or reassigned): only the lease
  is cleared, and `updatedAt` stays. A person's move always wins.

Each write is conditional on the lease the sweep read. A heartbeat that lands in between
renews the lease and wins. The rules are `decideExpiredLease` in `lib/agent-task-claim.ts`.

So a dead run is back in Ready within the lease plus one cron tick: 15 to 20 minutes by
default. A heartbeat every five minutes never races the lease.

Tasks claimed through `/claim-fixall` carry no lease. They are still released by the
repo-local stale-Doing sweep (`scripts/release-stuck-doing.ts`) until those loops move to
this route.

## Enrollment: the list setting

Each board has a list setting, **"Agents claim tasks before working them"**
(`TaskList.agentClaimRequired`, default off). It is a switch in the list's AI agent
section, and it is written by `PUT /api/v1/lists/:id` with an explicit boolean, owner or
admin only. It replaced the `ASTRID_AGENT_CLAIM_REQUIRED_LISTS` env allowlist.

Enrollment changes the generated queue skill for that board. The skill tells agents to
include unassigned Ready tasks, claim each one before work, skip conflicts, heartbeat while
working, and resume their own Doing claim after a restart. Enrollment does not reject
existing task updates or assignments, and the claim route works on every board either way.

## Clients

- The OAuth MCP server always lists `claim_task`. Its `action` includes `heartbeat`, and
  its optional `agent` maps to `agentMailbox`.
- `@gracefultools/astrid-sdk` exposes `AstridClient.claimTask` and
  `AstridClient.heartbeatTask`, plus these commands:
  - `astrid-agent claim <taskId>`: exit 0 claimed, 2 conflict, 1 error.
  - `astrid-agent heartbeat <taskId>`: exit 0 renewed, 2 claim gone, 1 error.
  - `claim --fixall`: still calls `/claim-fixall`.
- Astrid's cloud runner (`agent-run.yml`) renews every lease the run took with
  `scripts/heartbeat-held-claims.ts` every five minutes; it needs `ASTRID_RUN_STARTED_AT` and
  renews only leases taken since then (ADEV-37). An interactive session has no such loop and must
  heartbeat itself (MCP `claim_task { action: "heartbeat" }`).

## Rollback

Revert the route and service changes. The migration
(`20261116000000_add_agent_claim_lease`) is additive: three nullable `Task` columns, an
index, and `TaskList.agentClaimRequired BOOLEAN NOT NULL DEFAULT false`. Older code
ignores them, so a code rollback needs no schema change.

## Known limits

- **`already_yours` is per mailbox, not per worker.** Two sessions on one mailbox are only
  kept apart while their claims race; a later claim by the second gets `already_yours`.
  A worker that did not make the claim should treat `already_yours` on `claim` as taken.
  The same applies to `heartbeat`: the lease belongs to the mailbox.
- **A future start date is not checked**, unlike `/claim-fixall`. The queue already
  holds such tasks back, so claim only what the queue returned.
- **`release` unassigns the agent**, so on a board that is not enrolled for unassigned
  pickup, the task leaves the agent's queue.
- **A lease left on a task that is completed and reopened** before the lease ends is
  still honoured. If the reopened task is back in Doing with the same holder when the
  lease runs out, the task is released.
- **`/claim-fixall` and its board allowlist remain** for Astrid's own loops, unchanged.
  Retiring them, and the stale-Doing sweep scripts, follows once those loops use this route.
