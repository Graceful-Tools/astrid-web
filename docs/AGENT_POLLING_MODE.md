# Polling mode — the user's harness runs the agent

**Status:** shipped on `feat/agent-polling-mode`
**Code:** `lib/ai/agent-execution-mode.ts` (the rules), `app/api/v1/agent-queue/route.ts` (the queue),
`components/agent-runtime-settings.tsx` (the switch + the recipes), `/docs/loops` (the public page)

## The problem this exists for

Astrid had exactly one way to run an agent: the server calls a provider API on the
user's key the moment a task is assigned or commented on. That is the right answer
for someone with a phone and no harness. For everyone else it is the wrong one, in
three separate ways:

1. **It bills the work twice.** A Claude Code, Codex or Copilot subscription already
   covers coding work. Routing the same task through a metered API key pays for it
   again — and the harness is the better runtime anyway, because it has the repo, the
   branches and the test suite.
2. **It fails invisibly.** 2026-08-23, production: `Your credit balance is too low to
   access the Anthropic API`. Every change-request trigger returned 400, and the
   retry path treated a hard billing error like a transient one — **79 comment POSTs
   to one task in ~90 seconds**, up to 4/sec, all identical failures. A board watcher
   sees a task that will not move and no reason why.
3. **It cannot be told to stop.** Turning it off meant deleting the API key, which
   also removes the agent from the places the key legitimately powers.

Polling mode is the other answer. **Astrid calls nothing.** The task sits in the
agent's queue and the user's own harness picks it up on its own loop.

## What a user sees

Nothing about the agent changes. Same identity (`claude@astrid.cc`), same slot in the
assignee list, same comments, same assignment handshake. Settings → AI Agents gains a
per-agent switch:

| Mode | Who runs it | Costs |
|---|---|---|
| `api` | Astrid calls the provider on the user's saved key | Metered API tokens |
| `polling` | The user's harness reads the queue on a schedule | Their existing subscription |

Choosing `polling` reveals a copy-pasteable MCP config plus a loop recipe for Claude
Code, Codex, GitHub Actions, Gemini CLI and Cursor. The recipes live in ONE component
(`AgentLoopRecipes`) rendered by both the settings panel and `/docs/loops` — a settings
snippet that drifts from the docs snippet is how people paste a config that no longer
works.

## The rules (lib/ai/agent-execution-mode.ts)

Resolution order, and why each step is where it is:

1. **No server executor exists → polling, unoverridable.** `codex@` is a local harness
   identity; an `api` setting for it would be a preference Astrid could only disobey.
2. **An explicit setting → obey it.**
3. **A coding agent WITH a saved key → `api`.** Saving a key *is* choosing API mode.
   A default that flips a working setup to polling looks exactly like a dead agent.
4. **A coding agent WITHOUT a key → `polling`.** Nothing to spend, nothing to 400.
   This is the answer to the incident above: with no key, the old code dispatched
   anyway and produced a retry storm; now the task waits visibly in the queue.
5. **Anything else → `api`.** Notably `astrid@`, the assistant persona — it answers in
   chat for people who have no harness and never will.

Stored in `User.mcpSettings.agentModes`, keyed by **mailbox** rather than provider
service (`codex` has no service, and the user is choosing per agent-in-the-list).
Same blob as the API keys, read-modify-write, so switching to polling never discards
the key that brings the agent back.

**Whose setting?** `resolveAgentRunOwnerId()` — the list's `aiAgentConfiguredBy`, then
the task creator, then the list owner. Deliberately the same order the orchestrator
already uses to pick whose key to spend: an agent that runs on one person's key while
reading another's mode setting is the worst of both answers.

## Where the server now keeps its hands off

Four dispatch sites, all reading the one predicate `isPollingOnlyAgent()`:

| Site | What it used to do |
|---|---|
| `lib/webhooks/task-assignment-notifier.ts` | Push the assignment to a webhook / workflow. Now: SSE only, so the task still appears instantly in an open app. |
| `lib/webhooks/comment-notifier.ts` | Push the comment onward. Now: returns — the harness reads the comment on its next loop. |
| `lib/comments/post-comment-side-effects.ts` | Start an `AIOrchestrator` workflow on a comment. |
| `lib/comment-approval-detector.ts` | Approve / merge / change-request triggers — **the source of the retry storm**. Gated once at the door rather than at each of the four triggers. |

The first two replaced the hardcoded `isLocalHarnessAgentEmail()` check, which was
this same idea available only to `codex@`. Polling mode is that check generalised to
every agent and made a user setting.

## The queue

`GET /api/v1/agent-queue?agent=claude[&listId=…]`, and the MCP tool `get_agent_queue`
that proxies it. Three conditions, all required, reusing the predicates in
`lib/ready-queue-scope.ts` rather than restating them:

- **Ready** — `statusRole`, a field on the task
- **assigned to this identity** — assignment is the handshake
- **due** — a task carrying a future date is not work for today, so a repeating chore
  re-queues itself on completion and reappears when it comes due

Two deliberate differences from the local `/fixall` script:

- **Assignment is required.** `isClaimableByAgent` also takes unassigned tasks, which
  is safe on one person's own board and unsafe on a shared list, where an unassigned
  Ready task is somebody's untriaged note.
- **Visibility is the caller's, not the agent's.** The queue can only contain tasks
  the person driving the harness could already read.

Everything filtered out is counted, and anything waiting on a clock is listed with its
date. A queue held up by scheduling must never read as an idle one — silence is the
failure mode a scheduled loop cannot debug. An empty queue answers `empty: true`, so a
quiet run costs one HTTP request and stops.

## What this does not fix

The retry path still treats a hard 400 (billing, invalid key) like a transient error.
Polling mode removes the common trigger, but any user who keeps API mode and runs out
of credit can still produce the storm. That belongs in the retry logic itself —
non-retryable status codes should abort, not back off.

## Related

- `/docs/loops` — the public "run your agent on a loop" page
- `docs/FIXALL_WORKFLOW.md` — the loop this feature productizes
- `lib/ready-queue-scope.ts` — the queue predicates, shared with `scripts/ready-tasks.ts`
