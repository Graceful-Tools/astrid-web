# Weekly deep review

A weekly deep pass over **both** Astrid repos — `astrid-web` and `astrid-ios` — across eight
lenses: security, architecture, cross-platform contract drift, caching, production traffic,
performance, hygiene, and documentation. It is read-only on code. Its only side effects are
Astrid tasks and comments.

It supersedes the weekly hygiene review (`docs/WEEKLY_HYGIENE_REVIEW.md`), which covered
astrid-web only and ran from launchd.

| File | Role |
|---|---|
| `scripts/weekly-deep-review.prompt.md` | **The review. Edit this to change what it does.** |
| `docs/WEEKLY_DEEP_REVIEW.md` | This file — trigger, coordination, verification |
| `.claude/commands/weekly-deep-review.md` | Run it by hand from astrid-web |
| `astrid-ios/.claude/commands/weekly-deep-review.md` | Run it by hand from astrid-ios (the iOS delta) |

The prompt is **canonical and lives here only**. astrid-ios holds a thin delta that points at
it. This is the same split as `docs/FIXALL_WORKFLOW.md`, for the same reason: the two
`fixall.md` files had drifted by 440 lines. A duplicated review prompt would be worse — drift
means the two boards get findings judged by different rules.

## Trigger: a repeating Astrid task, not a cron

Per `docs/FIXALL_WORKFLOW.md`: *"To make something recurring, give the task a date and a
repeat in Astrid."* Completing the task rolls it to the next occurrence; the ready-tasks sweep
parks it in `Waiting` and promotes it back when due. There is no cron and no launchd job.

### Driver — on the **iOS** board

| | |
|---|---|
| Board | Astrid iOS To-do `aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36` |
| Title | `[weekly] Deep review — both repos (driver)` |
| Priority | 1 — a recurring chore at priority 3 permanently pins the top of the board |
| Repeat | Weekly, **repeat-from due date** so a late run does not drag the slot |

**Why the driver is on the iOS board, not the web board.** The `astrid` MCP server is
configured only for the `astrid-ios` project in `~/.claude.json`; `astrid-web` has none, and a
throwaway worktree has no project entry at all. So an agent working from astrid-ios is the
only one that can `get_tasks` and `create_task` on **both** boards over MCP, and it can still
`cd ../astrid-web` to run every OAuth script. The reverse is not true. Keep the driver here
even after adding MCP to astrid-web, so it cannot flip silently.

**Why one run covers both repos.** Cross-platform contract drift is a *comparison* — you
cannot detect that `RepeatingTaskCalculator` diverged from `astrid-web/types/repeating.ts`
from inside one repo. Splitting the review in half would force both halves to read both
repos, which is two full runs and double filing.

### Guard — on the **Web** board

| | |
|---|---|
| Board | Astrid Web To-do `a623f322-4c3c-49b5-8a94-d2d9f00c82ba` |
| Title | `[weekly] Deep review — web half (guard, do not run)` |
| Priority | 0 |
| Due | Same weekly cadence, **two hours after the driver** |

The guard exists so the web board shows the review happened, and so a web-board agent does not
start a second one. Its description tells the agent: if the driver has a `DEEP-REVIEW-CLAIM`
comment newer than 36 hours or is completed for this occurrence, comment and complete. If the
driver did not run — or is stuck in `Doing` with a claim older than 36 hours — say so on the
driver task, set it back to `Ready`, and run the review as the fallback.

Assign **both tasks to the same mailbox**. One mailbox on one machine sweeps its queue
sequentially, which is the single most effective de-race.

### Honest about the race

The claim comment is advisory, not a mutex: two agents that both read "no claim" in the same
second both run. The `Doing` status write is the real lock, because a `Doing` task is not in
`get_agent_queue` — which is why the prompt does it *first*, before commenting. Neither is
atomic. Same-mailbox plus a two-hour offset makes a collision very unlikely in this setup, but
it is not a guarantee.

The failure mode to actually expect is not a double run. It is a **crashed run leaving the
driver in `Doing` forever**, silently skipping every subsequent week. That is what the guard's
36-hour stale-claim branch is for, and it is the branch nobody ever tests — so test it.

### Creating the tasks

MCP cannot set a repeat today: `create_task` / `update_task` accept only `title`,
`description`, `dueDateTime`, `priority`, `completed`, `listId`. The REST API does support
`repeating` / `repeatingData`, so this is a gap in the MCP tool schemas, not the platform.
**Until that is fixed, create both tasks by hand in the Astrid UI.** There is a task on the
web board to add the repeat fields to the MCP schemas; once it lands, these become scriptable.

## Why this is not a cron job, and what we learned when it was

The retired launchd job left two machine facts worth keeping.

**launchd must invoke node, not zsh.** The job ran through
`scripts/run-weekly-hygiene-review.mjs` rather than pointing straight at the shell script,
because a `/bin/zsh` launched by launchd has **no TCC access to `~/Documents`** and dies at
the first `git` call with `fatal: Unable to read current working directory: Operation not
permitted`. `/opt/homebrew/bin/node` holds a Full Disk Access grant and children inherit it.
Measured:

```
zsh direct read : DENIED
node fs.readdir : OK
node->zsh child : OK
```

Any future scheduled job on this Mac will need this. Pointing launchd at a shell script makes
the job fail silently every week.

**A scheduled job must not depend on a shared checkout's branch.** The old job ran from a
dedicated worktree that it hard-reset to `origin/main` each run, and refused to self-update if
that worktree had local changes rather than destroying someone's work. The Astrid-task trigger
sidesteps this entirely — the agent runs in whatever checkout it is already working in — but
the lesson holds for anything that goes back to a scheduler.

## Changing the review

Edit `scripts/weekly-deep-review.prompt.md`. Nothing else needs to change; both repos read
that one file. Take particular care with three passages that are there because something went
wrong:

- The **`monitor:vercel*` ban** — it posts comments to real Astrid tasks and wrote three
  misleading ones on 2026-08-18.
- The **`weekly-review` ban** — it prints local dev counts under production headings.
- The **deploy-trigger paragraph** — this repo has been wrong about deploy behaviour three
  times in both directions, and an agent acted on each.

## Verification

Do not let the first real run be a Friday against the real boards.

1. **Dry-parse.** Run the prompt with an appended override: "Execute steps 1–3 fully, then
   STOP: print the summary and the tasks you WOULD file. File nothing." This exercises every
   evidence command and gives you the first Numbers table for free.
2. **Prove the filing path without writing.** `npx tsx scripts/file-ios-task.ts "[deep-review]
   test" "test" --dry-run` works. **`scripts/create-task.ts` has no `--dry-run`** — there is a
   task to add one.
3. **Use a scratch board.** Create a list `Astrid Review Sandbox` and override
   `ASTRID_OAUTH_LIST_ID` and `ASTRID_IOS_LIST_NAME` for the test run; both scripts resolve
   their target from env, so this needs no code change. Do not test against a real board with
   a `[test]` prefix — the whole point of the dedupe rule is that the boards stay trustworthy.
4. **Test the coordination rule.** On the sandbox, create driver and guard due five minutes
   out with a weekly repeat. Run the driver: confirm it goes to `Doing`, claims, files,
   completes, and **rolls forward**. That also exercises `RepeatingTaskCalculator` — if
   rollover is wrong, the whole trigger mechanism is wrong, and that is worth learning on day
   one. Run the guard: confirm it no-ops. **Then delete the claim, reset the driver to `Ready`,
   and run the guard again** to confirm the fallback branch actually runs a review.
5. **Dedupe regression.** Run it twice back to back against the sandbox. The second run must
   file ~zero. If it re-files the same findings with reworded titles, the dedupe instruction is
   too weak.
6. **One overlap week.** Leave the launchd job installed for exactly one Friday alongside the
   driver and compare. If the new review's web findings are a superset, retire the old job
   that day. If not, the diff tells you what was lost.
7. **Then retire the old job** — bootout *before* deleting anything, or a plist pointing at a
   deleted script fails silently every Friday forever:
   ```bash
   launchctl bootout gui/$(id -u)/cc.astrid.weekly-hygiene-review
   rm ~/Library/LaunchAgents/cc.astrid.weekly-hygiene-review.plist
   ```
   Finally delete the sandbox list and `git worktree remove ../astrid-web-hygiene ../astrid-web-review`.
