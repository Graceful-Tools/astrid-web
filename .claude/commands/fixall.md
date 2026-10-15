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
TDD → gates → report), filing the other repo's half, re-checking after every task, and *The
engagement contract* — the attention inbox that comes back on the same call as the queue, and
where an answer goes once you have one.

That file is shared with astrid-ios because it is one workflow. This file holds only what is
different **here**.

**First, take the working-tree lock** (docs/FIXALL_WORKFLOW.md → *One session per
working tree*). Exit 2 means another live `/fixall` session owns this checkout —
stop, and re-run from your own worktree via `npm run work:start <task-slug>`:

```bash
npx tsx scripts/fixall-session.ts acquire --pid $PPID --harness claude-code
```

**Unless `ASTRID_FIXALL_LOCK_HELD=1` — then the lock is already yours; do not acquire or
release it.** The scheduled runner (`scripts/fixall-loop.sh`, AWTD-971) takes the lock with
its OWN pid before starting Claude, so it can skip a busy tree without paying for a session
to find out. Inside `claude -p`, `$PPID` is the claude process — a **different live pid**
from the launcher's — so an acquire here would come back `2` and the run would stop before
reading the queue, blocked by its own launcher. Releasing would be worse: it exits `1` as
`held-by-other` and, if it ever succeeded, would unlock the tree while the run was still
editing it.

Then pull the queue with the identity of the harness that is actually running this
command:

```bash
# GitHub Copilot CLI / Copilot app
get_agent_queue { agent: "copilot", listId: "a623f322-4c3c-49b5-8a94-d2d9f00c82ba", includeUnassigned: true }

# Claude Code
get_agent_queue { agent: "claude", listId: "a623f322-4c3c-49b5-8a94-d2d9f00c82ba", includeUnassigned: true }

# Queue debugging only (never use the DB):
# Copilot:    scripts/ready-tasks.ts web --harness github-copilot
# Claude Code: scripts/ready-tasks.ts web --harness claude-code
```

`agent` never defaults: identify the current runtime, then pass its matching mailbox.
Copilot must not poll Claude's assignments, and Claude Code must not poll Copilot's.
The queue returns Ready tasks assigned to that identity **plus unassigned Ready tasks** on
the board (`assigned: false`) — whichever loop claims one first owns it. Tasks in `Doing`
are never returned: another agent or a person is already on them.

## One task per scheduled run

**If `ASTRID_FIXALL_MAX_TASKS` is set, stop after that many Ready tasks.** The runner here
sets it to `1`, and a `wip: … UNFINISHED, UNVERIFIED` branch tip is a resume point, not a
finished task — docs/FIXALL_WORKFLOW.md → *One task per scheduled run* has the rule and why.

## What is different here

- **DEPLOY WHAT YOU FINISH, once the gates are green.** Jon, 2026-10-13: *"Interactive
  sessions and automatic can deploy with clean tests and monitor to make sure it works.
  Don't block on me."* So a green run ends in production, not in a report offering to ship.

  > This bullet said **"NEVER DEPLOY. Not once, not 'just this one'"** until 2026-10-13, and
  > that was right while nobody had said otherwise — an agent once shipped five migrations by
  > getting it wrong. It is kept here because the *reason* still holds: the ban was never
  > about deploying, it was about deploying something unverified.

  A production deploy is a `workflow_dispatch` of
  `.github/workflows/production-deployment.yml` — nothing auto-deploys, and pushing still
  ships nothing. Dispatch it yourself when, and only when:

  ```bash
  npm run predeploy                                    # 16/16 on the MERGED main
  git diff origin/prod origin/main -- prisma/migrations/   # must be EMPTY, or ask Jon
  gh workflow run production-deployment.yml --ref main \
    -f skip_tests=false -f allow_destructive_migrations=false
  gh run watch <run-id> --exit-status                  # to completion, not an early green step
  scripts/verify-deployed-sha.sh "$(git rev-parse origin/main)"
  ```

  **Gate the MERGED `main`, not just the branch.** On 2026-10-13 all seven of a run's PRs
  were green individually and the gate on the merge still went red.

  **Two things are still not yours to decide.** A **pending migration** applies during the
  deploy, in a job that runs *before* the new code is live — four dropped columns took
  production down on 2026-09-18 and a redeploy could not undo it. So a non-empty migration
  diff goes to Jon, and `allow_destructive_migrations` stays `false`, which makes the
  workflow refuse rather than guess. And a **red gate** is red: if you believe it is a false
  alarm, prove it on the record first (a stale `.next/types` artifact did exactly this on
  2026-10-13 — see [AWTD-1245](https://astrid.cc/t/AWTD-1245)).

  Inside a scheduled `claude -p` session `gh` is denied, so the session cannot dispatch
  anything: the **runner** deploys after the run, the same arrangement that opens the PRs
  (`scripts/land-and-deploy.ts`, docs/FIXALL_WORKFLOW.md → *Deploying is part of finishing*).
- **Pushing is NOT deploying, and needs no permission.** This bullet said the opposite for a
  long time — "`git push origin main` is a production deploy" — and the claim was wrong every
  time it was written (AWTD-879, the fifth). Since #204 that workflow has one trigger,
  `workflow_dispatch`, so a push to `main` ships nothing. Push finished work at the END of a
  run, once, so Jon can review it without having to ask (CLAUDE.md rule 3;
  docs/FIXALL_WORKFLOW.md → *Pushing is part of finishing*). Establish the fact by reading
  the workflow file and `gh run list --workflow=production-deployment.yml`, never the Vercel
  deployment list — an Actions deploy appears there as `source=cli` and reads as a human. The
  ratchet is `tests/rules/pushing-main-does-not-deploy.test.ts`.
- **A task is DONE when production serves it** (Jon, 2026-10-13: *"Don't move to done until
  deployed to prod"*). Committed, gates green, PR merged, deployed, and
  `scripts/verify-deployed-sha.sh` agrees — *then* mark it complete, and say in the report
  what production is serving. The old finish line stopped at "committed with predeploy
  green", which is how [AWTD-839](https://astrid.cc/t/AWTD-839) sat committed-but-unpushed
  for seventeen days and [AWTD-1039](https://astrid.cc/t/AWTD-1039) sat PR-less for four,
  both while the board said done. A task whose deploy is gated on a migration stays
  **incomplete**, with the reason on it — do not mark it done and mention the gate in
  passing.
- **Claim each task atomically before working it**, with this harness's own mailbox:
  `npx tsx scripts/claim-fixall-task.ts <taskId> ready --agent claude`. Exit 2
  (`CLAIM_CONFLICT`) means a peer session took it first — move to the next task silently.
  This matters most for unassigned tasks: every loop polling the board sees them, and the
  claim is what makes exactly one of them the owner.
  Omitting `--agent` assigns the task to Copilot.
- **One isolated branch/worktree per task, and one `/fixall` session per working tree.**
  In a Copilot app session, use the branch and worktree the session already created; do not
  run raw branch-creation commands inside it. Other harnesses should reuse an already-isolated
  task branch or create one with their native session/worktree workflow.

  This is enforced, not merely advised: `scripts/fixall-session.ts` refuses to start a second
  run in a checkout another live session holds. On 2026-09-09 two Claude Code sessions ran
  here at once — one created a branch, moving `HEAD` while the other had six files
  uncommitted, and both wrote the same fix for AWTD-865. **Never run `git checkout` or
  `git checkout -b` in a tree you did not lock.**
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

A 500 on **every** route, with `application-code` at ~1ms and a `SyntaxError: Unexpected
non-whitespace character after JSON` naming no file, is a corrupt `.next` manifest, not your
component — `npm run dev` repairs it via its `predev` guard, and
[docs/fixes/DEV_SERVER_500_CORRUPT_NEXT_CACHE.md](../../docs/fixes/DEV_SERVER_500_CORRUPT_NEXT_CACHE.md)
explains why it reads as unrelated to the cache (AWTD-934).

## Environment gotchas

- `GET /api/v1/tasks/[id]` returns `{ task, meta }` — `body.lists` is undefined, and a script
  that assumes otherwise will compute an empty list and strip every membership.
- The repo's scripts load `.env.local` via dotenvx. A plain `import 'dotenv/config'` reads
  `.env` instead and silently yields undefined ids.
- `vercel` may not be on PATH, so `monitor:vercel` and `deploy-preview.sh` can fail. That does
  not block local work; note it rather than fighting it.
- `next-env.d.ts` is generated and flips between `./.next/types/…` and `./.next/dev/types/…`
  depending on whether `next dev` or `next build` ran last, so it shows up modified after any
  dev session. Revert it; do not commit the flip.
- **This file must exist on the branch you are working.** It lived only on an unmerged feature
  branch once, so it vanished on every checkout and the loop ran on whatever happened to be
  loaded in memory. If `/fixall` behaves unlike this document, check
  `git ls-files .claude/commands/` first.

See [ASTRID.md](../../ASTRID.md) for architecture, [docs/CLI_OPERATIONS.md](../../docs/CLI_OPERATIONS.md)
for deploy rules, and `/fixstuff` for the interactive, pick-one-task-at-a-time version.
