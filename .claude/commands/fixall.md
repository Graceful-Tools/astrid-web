Check the **Ready** list on the Astrid Web To-do and autonomously work every task on it to completion using the /fixstuff workflow. Designed to be safe to re-run on a schedule.

## Goal

**Drive the Ready list to empty.** Unlike `/fixstuff`, this does not ask which task to
work on — it takes them in priority order and keeps going until nothing is left.
It stops on its own when Ready is clear, so a scheduled re-run that finds it empty is
a no-op, not busywork.

**Ready, not the whole list.** The Web To-do holds plenty of tasks that are filed but
not triaged. `Ready` is Jon's signal that a task is actually actionable. Working
anything else is not autonomy, it is picking your own work.

## Scope: one board, one repo

**This loop works the Astrid Web To-do, and edits only `astrid-web`.** Both halves of
that sentence are load-bearing.

**A separate agent runs the same loop against the Astrid iOS To-do and the
`astrid-ios` repo.** That is why routing a task to the iOS board is a handoff and not
a parking space — something picks it up. It is also why doing iOS work from here is
actively harmful rather than merely off-topic: two agents editing `astrid-ios` will
collide, and genuine web tasks queue behind work that was never ours.

The Web To-do is where tasks get filed, not where they get sorted by platform, so
`[mac]` and `[ios]` tasks land on it regularly. For each task in Ready, decide which
of three it is:

1. **Web work** — closable by editing this repo. Work it normally.

2. **iOS/Mac only** — closable by editing Swift and nothing else. Route it to the
   board whose agent can work it, and move on:
   ```bash
   npx tsx scripts/move-task-to-list.ts <taskId> "Astrid iOS To-do"
   ```
   Comment on the task saying it was routed, so the move is not a mystery. That
   takes it out of Ready as a side effect, which is the point: a task this loop
   cannot act on should not sit at the top of this queue.

3. **Cross-platform** — a server/API change both clients consume, or a task that
   explicitly asks for both. **Do the web half here**, including any API work, then
   **file the iOS companion** on the Astrid iOS To-do spelling out the contract to
   match. Do not implement the Swift side from this repo.

**The test for (2) vs (3) is where the code lives, not who reported it or what the
title says.** A `[mac]` tag means a Mac user hit it, not that the cause is Mac-only.

**Check the web behaviour before routing a `[mac]`/`[ios]` bug.** If web has the same
bug, it is (3) and the web half is yours. If web already does the right thing, that
is positive evidence for (2) — and worth putting in the routing comment, because it
tells the iOS agent what correct looks like. Two examples from 2026-08-09: an
all-day-date bug where web already set midnight correctly, and a markdown-rendering
request web already satisfied — both genuinely (2), but only checkable by reading the
web code first.

**Never commit to `astrid-ios` from this loop.** Reading it is allowed for exactly one
purpose: answering a question about *this* repo's surface — "does iOS still call this
endpoint before I delete it" is web work, and the answer is only in that repo.
Reading it to verify or progress an *iOS task* is the other agent's job.

## Guardrails (do not skip)

- **NEVER push, merge, or deploy. Not once, not "just this one".** On web,
  `git push origin main` **is a production deploy**, and any Prisma migration on the
  branch **runs against production during that build**. Committing locally is
  autonomous; everything past that waits for an explicit go-ahead. Report what is
  ready to ship instead of shipping it. (CLAUDE.md rule 1 — it is stated there because
  an agent once got this wrong and shipped five migrations.)
- **One branch per task** (`fix/<short-description>`), and `npm run predeploy` green
  before the task is marked complete.
- **A red predeploy files its own Astrid task.** If it was your own mid-refactor
  breakage, close that task with a one-line explanation rather than leaving a false
  alarm on the board.
- **If a task is ambiguous or needs a product decision, skip it**, comment on the task
  saying exactly what decision is needed, and move to the next one. Do not guess at
  intent, and do not stall the whole run on one blocked task.
- **If a task is blocked by something outside the repo** — a client rollout, a
  third-party outage, a decision only Jon can make — say so on the task and move on.
  Do not close it, and do not work around the block by breaking users.
- **If every Ready task is blocked, say so in a few lines and stop.** A run that ends
  with "nothing actionable" is a correct run. Do not invent adjacent work to fill it;
  re-checking a blocked task costs one call, and inventing work costs a review.
- **If the same task fails twice**, stop working it, comment with what was tried and
  why it failed, and move on.

## Steps

1. **Read the Ready queue — one call**:
   ```bash
   npx tsx scripts/ready-tasks.ts
   ```
   Prints `READY_EMPTY`, or the queue in the order to work it (priority high → low,
   then oldest first). It resolves `Ready` by NAME and filters server-side via
   `listId`.

   This replaces `get-astrid-tasks` + one `analyze-task` per task, which cost six
   requests to discover there was nothing to do. Use `get-astrid-tasks.ts web` only
   when you want the whole board, not the queue.

   Note the failure mode it is written to avoid: a wrong list id returns an empty
   result, which reads exactly like "nothing to do". The script errors loudly if
   there is no list named `Ready` rather than reporting an empty queue.

2. **If it prints `READY_EMPTY`**, say so in one line and stop. Nothing else to do.

3. **Otherwise, report the queue** — **task titles**, in the order you will work them
   (priority high → low, then oldest first) — then start on the first one without
   waiting for a reply. Jon does not read task ids; name the task in every report.

4. **For each task**, follow the coding workflow in [ASTRID.md](../../ASTRID.md):
   - **Post the session link** so the user can follow along on mobile:
     ```bash
     npx tsx scripts/post-session-link.ts <taskId>
     ```
   - **Classify it first** (see *Scope* above). Route an iOS/Mac-only task and move
     on before doing anything else with it.
   - Analyze the issue — read the description AND every comment. Comments are where
     the previous attempt, the revert, and the reason usually are.
   - **Check whether it is already done.** Several tasks on this board describe work
     that shipped after they were written; `git log --oneline -- <path>` and a quick
     read of the code beat trusting the description. Verify against `main` before
     writing anything, and if it is done, say so with evidence rather than
     re-implementing it.
   - Post a short strategy comment to the task before writing code.
   - Create a feature branch (`fix/<short-description>`).
   - **RED-GREEN TDD (mandatory for bug fixes):**
     1. Write a failing test that reproduces the bug, citing the task id in the test
        name. Confirm it fails for the right reason.
     2. Implement the minimum change to make it pass.
     3. Refactor while tests stay green.
   - Run `npm run predeploy` and fix regressions. Run `npm run check:reuse` too.
   - Post a completion report on the task and mark it complete.

5. **RE-CHECK READY AFTER EVERY TASK — never work from the opening snapshot.**
   Re-run `scripts/ready-tasks.ts`. New tasks arrive while work is in progress, and a
   REOPENED task looks exactly like
   one that was never done. A reopened task means the previous fix missed: re-read it
   and look for a different cause rather than re-closing it on the same reasoning. If
   it was reopened with no comment, audit your own previous work for the gap and say
   what you found.

6. **When Ready is empty**, summarize in a few lines: tasks completed, tasks routed
   to the iOS board, tasks skipped and why, and which branches are waiting to ship —
   **by title, not by id or commit hash**. Then ask whether to ship.

## For UI tasks: look at it

"The layout is broken" cannot be diagnosed from markup. The Chrome extension is often
not connected, so use Playwright against a dev server instead: render the component in
a throwaway route under `app/[locale]/`, screenshot it, and **measure the DOM** rather
than trusting your eye. Delete the scaffolding afterwards and confirm `git status` is
clean.

Two traps worth knowing: a folder starting with `_` is a Next private folder and will
404, and swapping files under a running dev server corrupts its HMR state — restart it
rather than debugging the 500.

## Environment gotchas

- `GET /api/v1/tasks/[id]` returns `{ task, meta }` — `body.lists` is undefined, and a
  script that assumes otherwise will compute an empty list and strip every membership.
- The repo's scripts load `.env.local` via dotenvx. A plain `import 'dotenv/config'`
  reads `.env` instead and silently yields undefined ids.
- `vercel` may not be on PATH, so `monitor:vercel` and `deploy-preview.sh` can fail.
  That does not block local work; note it rather than fighting it.
- **This file must exist on the branch you are working.** It lived only on an
  unmerged feature branch once, so it vanished on every checkout and the loop ran on
  whatever happened to be loaded in memory. If `/fixall` behaves unlike this document,
  check `git ls-files .claude/commands/` first.

See [ASTRID.md](../ASTRID.md) for architecture and the full coding workflow,
[docs/CLI_OPERATIONS.md](../docs/CLI_OPERATIONS.md) for deploy rules, and `/fixstuff`
for the interactive, pick-one-task-at-a-time version of this.
