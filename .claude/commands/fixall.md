Check the **Ready** list on the Astrid Web To-do and autonomously work every task on it to completion. Designed to be safe to re-run on a schedule.

## Goal

**Drive the Ready list to empty — and clear `RECHECK` / `REVIEW`.** Unlike `/fixstuff`, this
does not ask which task to work on — it takes them in priority order and keeps going until
nothing is left. The queue script also sweeps the board's lanes honest (dated Ready work parks
in Waiting; met conditions promote back) and may print `RECHECK` (re-verify an external
condition, then promote or bump its date) and `REVIEW` (Waiting with no recorded condition —
give it one or hand it back) sections: those are part of the run, not commentary. It stops on
its own when all three are clear, so a scheduled re-run that finds nothing is a no-op, not
busywork.

## The workflow itself is shared

**Read [docs/FIXALL_WORKFLOW.md](../../docs/FIXALL_WORKFLOW.md) — it is the canonical
description** of the queue (board ∩ Ready ∩ assignee ∩ due date), the board etiquette
(`Doing` / `Waiting` / handing back), the per-task loop (strategy comment → branch → RED-GREEN
TDD → gates → report), filing the other repo's half, and re-checking after every task.

That file is shared with astrid-ios because it is one workflow. This file holds only what is
different **here**.

Pull the queue with the identity of the harness that is actually running this
command:

```bash
# GitHub Copilot CLI / Copilot app
get_agent_queue { agent: "copilot", listId: "a623f322-4c3c-49b5-8a94-d2d9f00c82ba" }

# Claude Code
get_agent_queue { agent: "claude", listId: "a623f322-4c3c-49b5-8a94-d2d9f00c82ba" }

# Queue debugging only (never use the DB):
# Copilot:    scripts/ready-tasks.ts web --harness github-copilot
# Claude Code: scripts/ready-tasks.ts web --harness claude-code
```

`agent` never defaults: identify the current runtime, then pass its matching mailbox.
Copilot must not poll Claude's assignments, and Claude Code must not poll Copilot's.
Only tasks assigned to that selected identity are returned; unassigned Ready tasks are
someone's untriaged note.

## What is different here

- **NEVER push, merge, or deploy. Not once, not "just this one".** On web,
  `git push origin main` **is a production deploy**, and any Prisma migration on the branch
  **runs against production during that build**. Committing locally is autonomous; everything
  past that waits for an explicit go-ahead. Report what is ready to ship instead of shipping
  it. (CLAUDE.md rule 1 — stated there because an agent once got this wrong and shipped five
  migrations.)
- **A task is DONE when it is committed on its branch with `npm run predeploy` green.** Say in
  the completion report that it is ready to ship rather than that it shipped.
- **One isolated branch/worktree per task.** In a Copilot app session, use the branch and
  worktree the session already created; do not run raw branch-creation commands inside it.
  Other harnesses should reuse an already-isolated task branch or create one with their native
  session/worktree workflow.
- **Gates:** `npm run predeploy`, plus `npm run check:reuse`.
- **A red predeploy files its own Astrid task.** If it was your own mid-refactor breakage,
  close that task with a one-line explanation rather than leaving a false alarm on the board.
- **If a task is blocked by something outside the repo**, park it in `Waiting` with the right
  condition (docs/FIXALL_WORKFLOW.md → *Waiting carries its condition*): a decision only Jon
  can make → assign to Jon with the question; blocked on another task → `BLOCKED-BY: <id>`;
  blocked on an external event → `BLOCKED-ON: <condition>` plus a recheck due date. Do not
  close it, and do not work around the block by breaking users.
- **If every Ready task is blocked, say so in a few lines and stop.** A run that ends with
  "nothing actionable" is a correct run. Do not invent adjacent work to fill it; re-checking a
  blocked task costs one call, and inventing work costs a review.

## For UI tasks: look at it

"The layout is broken" cannot be diagnosed from markup. The Chrome extension is often not
connected, so use Playwright against a dev server instead: render the component in a throwaway
route under `app/[locale]/`, screenshot it, and **measure the DOM** rather than trusting your
eye. Delete the scaffolding afterwards and confirm `git status` is clean.

Two traps worth knowing: a folder starting with `_` is a Next private folder and will 404, and
swapping files under a running dev server corrupts its HMR state — restart it rather than
debugging the 500.

## Environment gotchas

- `GET /api/v1/tasks/[id]` returns `{ task, meta }` — `body.lists` is undefined, and a script
  that assumes otherwise will compute an empty list and strip every membership.
- The repo's scripts load `.env.local` via dotenvx. A plain `import 'dotenv/config'` reads
  `.env` instead and silently yields undefined ids.
- `vercel` may not be on PATH, so `monitor:vercel` and `deploy-preview.sh` can fail. That does
  not block local work; note it rather than fighting it.
- **This file must exist on the branch you are working.** It lived only on an unmerged feature
  branch once, so it vanished on every checkout and the loop ran on whatever happened to be
  loaded in memory. If `/fixall` behaves unlike this document, check
  `git ls-files .claude/commands/` first.

See [ASTRID.md](../../ASTRID.md) for architecture, [docs/CLI_OPERATIONS.md](../../docs/CLI_OPERATIONS.md)
for deploy rules, and `/fixstuff` for the interactive, pick-one-task-at-a-time version.
