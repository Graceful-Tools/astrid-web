# Agent task claim API

`POST /api/v1/tasks/:id/claim` provides atomic task ownership transitions for
agent harnesses on any board. The route is additive and returns `404` unless
`ASTRID_AGENT_CLAIM_API=on`; the default is off.

The request must use an authenticated credential authorized to write the task.
The acting agent is taken from that credential's agent binding (or from an
authenticated AI-agent account), not selected by the request. An optional
`agentMailbox` confirms the bound mailbox's local part; a different or unknown
mailbox is rejected.

```json
{ "action": "claim", "agentMailbox": "codex" }
```

`action` is `claim`, `resume`, or `release`.

| Action | Transition | Successful outcome |
|---|---|---|
| `claim` | An incomplete Ready task becomes Doing and is assigned to the authenticated agent. The status, assignment, and task-write access are rechecked in the conditional update. | `claimed` |
| `resume` | Does not change the task. Confirms an incomplete Doing task is already assigned to this agent. | `already_yours` |
| `release` | An incomplete Doing task owned by this agent returns to Ready and this agent is removed from the assignee list; any remaining assignee becomes primary. | `released` |

Every response has an `outcome` and a task snapshot (`id`, `statusRole`,
`completed`, `assigneeId`, `assigneeIds`, and `updatedAt`). The task is `null`
when the outcome is `not_found` or `forbidden`.

| Outcome | HTTP status | Meaning |
|---|---:|---|
| `claimed`, `already_yours`, `released` | 200 | The action succeeded or was already satisfied. |
| `conflict` | 409 | Another agent owns the claim, or the task changed before the atomic update. |
| `not_ready` | 409 | The task is completed or is not in the state required for this action. |
| `not_found` | 404 | No task has this id. |
| `forbidden` | 403 | The caller cannot write the task or act as the bound agent. |

Malformed actions or request bodies return `400`. This API does not change the
existing `/api/v1/tasks/:id/claim-fixall` route or its board/mailbox
allowlists.

The OAuth MCP server exposes this operation as `claim_task` only when
`ASTRID_AGENT_CLAIM_API=on`, and `@gracefultools/astrid-sdk` exposes it as
`AstridOAuthClient.claimTask`. The MCP tool maps its optional `agent` mailbox
to `agentMailbox`.

`ASTRID_AGENT_CLAIM_REQUIRED_LISTS` is a comma-separated board-ID allowlist
with an empty default. It changes generated queue-skill guidance only, and is
ignored unless the master switch is on. Enrolled-board guidance tells agents
to claim before work, skip conflicts, and resume their own Doing claim after a
restart. It does not reject existing task updates or assignments. Remove a
board ID to roll back enrollment; no schema change is involved.

## Rollback

Keep `ASTRID_AGENT_CLAIM_API` unset/off to make the route return `404`, or revert
the route and its service changes. No database migration or flag change in a
deployed environment is part of this implementation.
