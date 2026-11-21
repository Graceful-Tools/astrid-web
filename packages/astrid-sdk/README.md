# @gracefultools/astrid-sdk

The Astrid agent runner: the `astrid-agent` command that a scheduler or a CI job
runs to check for work, claim it and give it back, plus the typed REST client
that command is built on.

It is **not** a library for building agents. Your agent is whatever harness you
already run (Claude Code, Copilot CLI, Codex, your own service). This package
answers three questions around it: is there work, is it mine, and what happens
if the run dies.

## Install

```bash
npm install -g @gracefultools/astrid-sdk     # puts astrid-agent on PATH
# or, in a CI step:
npx -p @gracefultools/astrid-sdk astrid-agent queue --agent claude
```

Node 18 or later.

## Credentials

Read from the environment and never printed:

| Variable | Meaning |
|---|---|
| `ASTRID_TOKEN` | An agent-bound token (`astrid_mcp_…` or an agent consent token), sent as `Authorization: Bearer`. Preferred. Writes are signed as that agent, and the claim route knows which agent is claiming. |
| `ASTRID_CLIENT_ID`, `ASTRID_CLIENT_SECRET` | OAuth client credentials, exchanged for a one-hour token and sent as `X-OAuth-Token`. `ASTRID_OAUTH_CLIENT_ID` and `ASTRID_OAUTH_CLIENT_SECRET` work too. |
| `ASTRID_API_URL` | Server origin. Default `https://www.astrid.cc`. `--origin` overrides it. |

## The command

Exit codes are the interface, so a shell `if` or a workflow `if:` can branch on them.

### `astrid-agent queue`

```bash
astrid-agent queue --agent <mailbox> [--list <listId>] [--include-unassigned] \
                   [--seen <file> [--write-seen]]
```

Reads `GET /api/v1/agent-queue` and decides whether a run should start.

| Exit | Meaning |
|---|---|
| 0 | There is work: a Ready task, or a reply nobody has answered that this runner has not already woken for. Start a run. |
| 3 | Nothing to do. Skip this tick. |
| 1 | Could not tell (network, auth, server error). **Never treat this as idle.** |

stdout is one JSON document (`work`, `reason`, `summary`, `wakeKeys`, `snapshot`),
so you can pipe it to `jq`. The one-line `QUEUE:` summary goes to stderr.

Waking is bounded. `--seen <file>` holds the reply keys that have already woken
a run, and a key in that file does not wake another. `--write-seen` saves the
current keys after the decision. Ready tasks are never muted this way: a Ready
task stays work until someone moves it.

### `astrid-agent claim <taskId>`

```bash
astrid-agent claim <taskId> [--agent <mailbox>] [--resume] [--lease-seconds <n>]
astrid-agent claim <taskId> --fixall [--agent <mailbox>] [--list <listId>]
```

An atomic claim through `POST /api/v1/tasks/:id/claim`
([contract](https://github.com/Graceful-Tools/astrid-web/blob/main/docs/AGENT_CLAIM_API.md)),
on any board. The claim holds a lease (15 minutes, or `--lease-seconds` from 60
to 3600): run `astrid-agent heartbeat` while you work, or the task returns to
Ready. With client credentials, `--agent` names the agent you claim for.
`--resume` checks that a Doing claim still belongs to you after a restart.
`--fixall` claims through `/claim-fixall` instead: that route serves Astrid's
own scheduled loops on its allowlisted boards and accepts client credentials.
If `ASTRID_FIXALL_CLAIMS_FILE` is set, each claimed id is appended to it, so the
runner can release leftover claims after the run.

| Exit | Meaning |
|---|---|
| 0 | Claimed (or, with `--resume`, still yours). Start the task. |
| 2 | Another worker has it, or it is no longer Ready. Move on to the next task. |
| 1 | Error, including a server too old to have the claim API. |

A claim that answers `already_yours` exits 2: another worker on the same mailbox
holds the task.

### `astrid-agent heartbeat <taskId>`

```bash
astrid-agent heartbeat <taskId> [--agent <mailbox>] [--lease-seconds <n>]
```

Renews your claim lease. Send it every few minutes while working. Exit 0
renewed; 2 the claim is gone (the lease expired and the task went back to
Ready, or someone else holds it), so stop work; 1 error.

### `astrid-agent release <taskId>`

```bash
astrid-agent release <taskId> [--agent <mailbox>] [--comment <text>]
```

Gives a Doing claim back: the task returns to Ready and this agent is
unassigned. `--comment` posts the reason first. Exit 0 released, 2 not your
Doing claim, 1 error.

### `astrid-agent run`

```bash
astrid-agent run --agent <mailbox> [--list <listId>] [--task <taskId>] [--include-unassigned] \
                 [--harness claude|codex|copilot|custom] [--command <shell command>] [--lease-seconds <n>] \
                 [--fixall]
```

One call for a whole run: reads the queue, claims the first task a peer has not
taken, starts the harness with the task as its prompt (preceded by the task's list instructions
and project goals from the queue, each already wrapped as untrusted guidance by the server; with
`--task` the queue is not read, so neither is included), renews the claim lease
every third of the lease while it works, and, if the harness fails, comments the
reason and releases the claim so the next run can take the task.

`--harness` is a setting (default `claude`): `claude -p`, `codex exec`,
`copilot -p`, or `custom` with `--command`, which runs through a shell and reads
`ASTRID_TASK_ID`, `ASTRID_TASK_IDENTIFIER`, `ASTRID_TASK_TITLE`,
`ASTRID_TASK_PROMPT` and `ASTRID_AGENT` from its environment.

`--fixall` claims through `claim-fixall`, the route that client credentials can
use (the generic claim route answers them `forbidden`; an agent-bound
`ASTRID_TOKEN` does not need it). A fixall claim carries no lease, so no
heartbeat is sent. Each claim is appended to `ASTRID_FIXALL_CLAIMS_FILE` when
that is set, and a failed task is commented on but left for the caller's own
release step, as Astrid's cloud worker does.

| Exit | Meaning |
|---|---|
| 0 | The harness finished. |
| 3 | Nothing to claim. |
| 2 | The claim was lost mid-run (the lease lapsed); the harness was stopped. |
| 1 | The harness failed (the task was released), or an error. |

### `astrid-agent status`

```bash
astrid-agent status --agent <mailbox> [--list <listId>] [--include-unassigned]
```

Prints `{ mode, queued, attention, snapshot }` as JSON.

### Example: a GitHub Actions gate

```yaml
- name: Is there work?
  id: queue
  env:
    ASTRID_TOKEN: ${{ secrets.ASTRID_CLAUDE_MCP_TOKEN }}
  run: |
    set +e
    npx -y -p @gracefultools/astrid-sdk@1 astrid-agent queue --agent claude > queue.json
    code=$?
    case $code in
      0) echo "has-work=true" >> "$GITHUB_OUTPUT" ;;
      3) echo "has-work=false" >> "$GITHUB_OUTPUT" ;;
      *) exit 1 ;;   # could not tell: fail loudly, never skip silently
    esac
```

## The client

```ts
import { AstridClient } from '@gracefultools/astrid-sdk'

const astrid = new AstridClient({ auth: { token: process.env.ASTRID_TOKEN! } })

const snapshot = await astrid.getQueue({ agent: 'claude', listId })
for (const task of snapshot.queue) {
  const claim = await astrid.claimTask(task.id, { action: 'claim' })
  if (claim.outcome !== 'claimed') continue
  // ...run your harness...
  await astrid.addComment(task.id, 'Done: ...')
}
```

| Method | Endpoint |
|---|---|
| `getQueue({ agent, listId?, includeUnassigned? })` | `GET /api/v1/agent-queue` |
| `claimTask(id, { action, agentMailbox?, leaseSeconds? })` | `POST /api/v1/tasks/:id/claim`. Returns every documented outcome; `outcome: 'unavailable'` when the route is absent. |
| `heartbeatTask(id, { agentMailbox?, leaseSeconds? })` | the same route, `action: 'heartbeat'`; `outcome: 'renewed'` means keep going |
| `releaseTask(id, agentMailbox?)` | the same route, `action: 'release'` |
| `claimFixallTask(id, { action, agent?, listId?, commentWatermark? })` | `POST /api/v1/tasks/:id/claim-fixall` |
| `getTask(id)`, `getComments(id)` | `GET /api/v1/tasks/:id`, `…/comments` |
| `addComment(id, content, { aiAgentId? })` | `POST /api/v1/tasks/:id/comments` |
| `setStatus(id, statusRole)` | `PUT /api/v1/tasks/:id` |
| `handBack(id, personId)` | `PUT /api/v1/tasks/:id` with `{ statusRole: null, assigneeId }`: back to that person's Inbox |

A refused request throws `AstridApiError`, with `status` and the server's reason.
`decideQueueVerdict` and `wakeKeys` are exported too: they hold the wake rule
that `astrid-agent queue` applies.

## Upgrading from 0.x

1.0.0 removes the library half of the package:

| Removed | Replacement |
|---|---|
| `AstridChannel`, `SSEClient`, `ChannelRestClient`, `ChannelOAuthClient`, `SessionMapper`, message formatters | Moved to `@gracefultools/openclaw-astrid-channel`, which was their only user. |
| `AstridOAuthClient` | `AstridClient`. Its `claimTask` returns `{ status, outcome, task }`. |
| `deployToVercel`, `isVercelConfigured` | None. Deploy with your own tooling. |
| `loadAstridConfig`, `getAgentWorkflowConfig`, `.astrid.config.json` templates, platform detection | None. These belonged to the removed built-in executors. |
| `AI_AGENT_CONFIG`, `getAgentModel` and the agent registry | None. Ask the server (`/api/v1/users/me/available-agents`). |
| Executor types (`CodeGenerationRequest`, `ImplementationPlan`, …) | None. |

0.8.x stays on npm for anyone who still needs it (`npm install @gracefultools/astrid-sdk@0.8`).

## License

MIT
