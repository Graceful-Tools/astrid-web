Check the Astrid Web To-do list and autonomously work every Ready task to completion. Designed to
be safe to re-run on a schedule.

## Goal

**Drive the web Ready queue to empty.** Unlike `/fixstuff`, this does not ask which task to work
on — it takes them in priority order and keeps going until nothing is left. It stops on its own
when Ready is clear, so a scheduled re-run that finds it empty is a no-op, not busywork.

## The workflow itself is shared

**Read [docs/FIXALL_WORKFLOW.md](../../docs/FIXALL_WORKFLOW.md) first**. It is the canonical
workflow for both repos: queue rules (board ∩ Ready ∩ assignee ∩ due date), board etiquette
(`Doing` / `Waiting` / handback), per-task loop (strategy comment → RED-GREEN TDD → gates →
report), cross-repo filing, and re-checking after every task.

This file only defines what is different for **astrid-web**.

## Guardrails (do not skip)

- **Do not push, merge, or deploy without explicit user approval.** Production deploys are
  manual; pushing to `main` alone does not ship. Shipping still requires an explicit "Ready to
  ship it?" / "ship it" handshake.
- **A task is DONE when it is committed locally on its branch with web gates green.** Report it
  as ready to ship, not shipped.
- **One isolated branch/worktree per task.** In Copilot app sessions, use the branch/worktree the
  session already created; do not run raw branch-creation commands.
- **Required gates:** `npm run predeploy` and `npm run check:reuse`.
- **Never leave red gates.** If a failing gate is unrelated, say that plainly with why; do not
  proceed as if green.
- **If a task is ambiguous or blocked on Jon, hand it back** by assigning to Jon and moving it to
  `Waiting`, then continue with the next actionable Ready task.
- **If all Ready tasks are blocked, report that and stop.** Do not invent side work.

## Scope: one board, one repo

This loop edits only `astrid-web`. If a task needs an iOS/macOS change, file the iOS companion
task immediately:

```bash
npx tsx scripts/file-ios-task.ts "[ios] <what iOS must do>" "<contract to match>" -p 2
```

Then continue the web half here.

## Steps

1. Pull the queue:
   ```bash
   npx tsx scripts/ready-tasks.ts --harness <claude-code|github-copilot|codex|astrid-server>
   ```
   (Board defaults to `web`; harness must be explicit.)
2. If queue is empty, report empty and stop.
3. For each queued task, follow `docs/FIXALL_WORKFLOW.md` plus web-specific gates above.
4. Re-check the queue after every task using the same command.
5. When queue is empty, summarize what was completed and what was skipped/blocked with reasons.

## Environment gotchas

- `GET /api/v1/tasks/[id]` returns `{ task, meta }`; `body.lists` is undefined.
- Scripts load `.env.local` via dotenvx; `import "dotenv/config"` reads `.env` instead.
- `vercel` missing on PATH may break deployment-monitor commands; this does not block local fixes.

See [ASTRID.md](../../ASTRID.md) for coding workflow details,
[docs/CLI_OPERATIONS.md](../../docs/CLI_OPERATIONS.md) for deploy/approval rules, and
[`/fixstuff`](./fixstuff.md) for interactive, pick-one-task-at-a-time operation.
