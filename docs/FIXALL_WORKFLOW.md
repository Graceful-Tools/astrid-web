# The `/fixall` workflow

**One description of the autonomous loop, for both repos.** `astrid-web/.claude/commands/fixall.md`
and `astrid-ios/.claude/commands/fixall.md` each hold only what is genuinely different about
their repo — which board, which gates, and what "done" means there — and point here for the rest.

They were two ~300-line files describing one workflow, and they had drifted by 440 lines: the
iOS one knew about the due-date gate and the web one did not, the wording of the assignee
handshake differed, and only one of them explained why `move-task-to-list.ts` is the wrong
script. A rule worth following in one repo is worth following in the other, and a rule written
twice is a rule that disagrees with itself.

---

## The queue

**Read and write tasks through the `astrid` MCP server** (`https://www.astrid.cc/mcp`), not
scripts and never the database (Jon, 2026-08-29: the DB is for deep repair only).

```
get_agent_queue { agent: "<current harness mailbox>", listId: "<board id>" }
```

The current runtime determines the mailbox: GitHub Copilot CLI / the Copilot app
passes `copilot`; Claude Code passes `claude`; local Codex passes `codex`. Never
copy another harness's selector from an example.

Boards: Astrid Web To-do `a623f322-4c3c-49b5-8a94-d2d9f00c82ba`, Astrid iOS To-do
`aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36`. Answers `empty: true`, or `queue` in the order to work
it, plus `held.scheduled` for anything waiting on its date. `agent` never defaults — guessing
would claim another harness's work — and a typo fails loudly rather than answering "nothing".

The predicates are `lib/ready-queue-scope.ts`, the same ones `scripts/ready-tasks.ts` uses, so
the local script and the MCP queue cannot silently disagree. (`ready-tasks.ts` remains for
debugging the queue itself; it is not how a loop reads it.)

A task is yours only when **all four** hold:

1. **On the board** named for this loop — pass `listId`. `Ready` is account-wide and shared by
   every board, so filtering on it alone would hand the web loop iOS work.
2. **Ready status.** The rest of the board is filed but not triaged. Working anything else is
   not autonomy, it is picking your own work.
3. **Assigned to this agent.** The MCP queue REQUIRES assignment — an unassigned Ready task is
   somebody's untriaged note, not an invitation. (The local script also took unassigned tasks;
   the MCP does not.) If something is genuinely yours, say so and let Jon assign it; do not
   work around the filter.
4. **Due now.** See below.

The queue reports what it held and why (`held.notDueCount`, `held.scheduled`), so a queue
held up by the clock never looks like an idle one.

### The lanes must be REAL (Jon, 2026-08-29)

**Ready means "actionable now". Doing means "being worked right now". Waiting means "paused
on a NAMED condition".** A dated task sitting in Ready is Ready lying to whoever looks at the
board, so the queue script — not the agent, and not this document — keeps the lanes honest
with a mechanical sweep on every run:

- A **Ready task with a future date** (claimable by this loop) is **moved to `Waiting`**, with
  a comment saying when it returns. Ready never holds scheduled work.
- A **Waiting task whose condition is met** comes back: date arrived → back to `Ready`
  automatically; blockers completed → back to `Ready` automatically; external condition due
  for a recheck → surfaced to the agent (below).
- The sweep only ever touches tasks that are **unassigned or assigned to this harness**. A
  person's tasks are theirs to move, and `Doing` is never touched — a peer session or a human
  may be mid-task. Doing tasks are listed with their assignee so a human can spot a stale claim.

The sweep is a feature of `scripts/ready-tasks.ts` (OAuth API, never the DB), not of the MCP
queue: `npx tsx scripts/ready-tasks.ts <web|ios> --harness <current-harness>` runs it
(`github-copilot` for Copilot, `claude-code` for Claude Code), and
`--dry-run` prints every move it would make without writing anything. Run it at the top of a
loop when the board looks stale; the MCP `get_agent_queue` call is still how the work is read.
GitHub Actions consumes the authoritative machine form,
`scripts/ready-tasks.ts <web|ios> --json --harness <selector> [--dry-run]`, whose stdout is
`{"version":1,"tasks":[{"id":"<uuid>","action":"ready"},{"id":"<uuid>",
"action":"recheck|review","commentWatermark":"<ISO timestamp|null>"}]}`. Task titles are
excluded so presentation text can never become an executable task ID. A worker must atomically
revalidate the action, board, status, due state, completion, assignee, and waiting-comment
watermark before claiming; a stale queue entry is skipped, never reassigned.

### A task with a date waits for its date — in Waiting

Jon, 2026-08-19: *"If a task has a date don't start until the date or time of the task.
Therefore we can have fixall respond to recurring tasks and track them in Astrid."*

**This is how recurring work runs.** Completing a repeating task rolls it forward to its next
occurrence — `RepeatingTaskCalculator` already does that — the sweep parks it in Waiting, and
promotes it back to Ready the run after its date arrives. So a recurring chore leaves the
queue when it is finished and comes back by itself when it is due. The schedule lives in
Astrid, where Jon can see and change it from his phone, rather than in a cron file or in this
document. To make something recurring, give the task a date and a repeat in Astrid.

- **No date** → workable now. That is every task the loop took before this existed.
- **All-day** → workable from the start of its day, since an all-day task carries midnight.
- **Unreadable date** → treated as *no date*, never as "never". Stranding a task on a value
  nobody can see would look exactly like an empty queue, every run, with nothing saying why.

If the queue is empty but something is parked, the script says when the next one comes due —
a quiet run and a finished one are different things.

### Waiting carries its condition, machine-readably

Every Waiting task this loop owns must say WHAT it is waiting for, in a form the queue script
can re-check on every run. Three kinds of condition, three mechanisms:

| Waiting on… | How it is recorded | Who re-checks it |
|---|---|---|
| **a date** | the task's own due date | the script — promotes to Ready when due |
| **another task** | a comment line `BLOCKED-BY: <task-id>` (repeatable) | the script — promotes when every blocker is complete |
| **an external event** (a dependency release, a vendor fix, a client rollout) | a comment line `BLOCKED-ON: <one-line condition>` **plus a recheck due date** | the agent — the script surfaces it under `RECHECK` when the date arrives |

The **latest marker-bearing comment wins wholesale** — to change the conditions, post a new
comment with the new markers (or none of the blocking kind). Do not edit old comments.

External conditions never auto-promote: the script cannot know whether npm shipped a package,
so when the recheck date arrives the task appears under `RECHECK (n)` with its condition, and
the agent re-verifies it that run — condition met → move it to `Ready` (or just work it);
still blocked → post what was checked and **bump the due date** to the next sensible recheck,
and it goes quiet again. That date is the efficiency lever: zero attention spent between
rechecks, guaranteed attention when one is due.

A Waiting task with **no date, no `BLOCKED-BY`, and no `BLOCKED-ON`** will never wake up on
its own. The script lists these under `REVIEW (n)` and the agent triages each one, every run,
until the section is empty: give it the condition it is actually waiting on, or hand it back
to Jon (assign + a question) if only he knows. `RECHECK` and `REVIEW` are WORK the run must
do, not information — `READY_EMPTY` with a non-empty `RECHECK`/`REVIEW` section is not a
finished run.

---

## Say on the board what you are doing

The board is where Jon looks. A task being worked and a task nobody has touched must not look
identical there.

The MCP server has no status or assign tool yet, so these two steps — and only these — use the
OAuth scripts in astrid-web. Not the database.

**Starting → move it to `Doing`**, before the strategy comment, so the window where the board
is wrong is as small as possible:

```bash
cd ../astrid-web && npx tsx scripts/set-task-status.ts <taskId> Doing
```

**Blocked → move it to `Waiting`, and record the RIGHT condition** (see *Waiting carries its
condition* above). Who keeps the task depends on who can lift the block:

- **Only Jon can lift it** (a product decision, an account credential): assign to him AND move
  to `Waiting` — both, not one. Assigning alone leaves it in Doing, which reads as
  in-progress; moving alone leaves it assigned to the agent, which reads as still yours. Then
  say on the task what decision you need.

  ```bash
  npx tsx scripts/assign-task.ts <taskId> jonparis@gmail.com
  npx tsx scripts/set-task-status.ts <taskId> Waiting
  ```

- **Time, another task, or an external event can lift it**: KEEP the assignment, move to
  `Waiting`, and post the machine-readable condition — `BLOCKED-BY: <task-id>`, or
  `BLOCKED-ON: <condition>` with a recheck due date, or just the date. The loop now owns the
  recheck; Jon owns nothing he didn't ask for.

A task in `Waiting` with no condition and no question on it is just a task nobody is working.
The point of `Waiting` is that a re-run stops re-reading it — a blocked task left in Ready is
re-examined every fifteen minutes forever and reported as blocked every time, which is the
no-op loop this workflow exists to avoid.

**Use `set-task-status.ts`, never `move-task-to-list.ts`.** Status is a SECOND membership
alongside the board, and `PUT` replaces the whole `listIds` set — so `move-task-to-list.ts`,
which is correct for moving between boards, would put the task on Doing and take it OFF its
board, out of every queue, findable only by id. The status script keeps the board, refuses to
write if the task would be stranded, and reads back to prove it.

**Completing a task takes it out of `Doing` on its own** — no status change needed first.

---

## Per task

1. **Move it to `Doing`** (above), before anything else.
2. **Post the session link** so Jon can follow on mobile:
   `npx tsx scripts/post-session-link.ts <taskId>`
3. **Read the description AND the comments/attachments** — `get_task` and `get_task_comments`. A screenshot attached to the task is
   usually the fastest route to the real cause.
4. **Check where the fix actually lives before writing any.** If it belongs to the other repo,
   file it there NOW (below) rather than discovering it three steps later.
5. **Post a short strategy comment** before writing code — `add_comment { taskId, content, type: "MARKDOWN" }`.
6. **One branch per task**, `fix/<short-description>`.
7. **RED-GREEN TDD, mandatory for bug fixes.** Write a failing test that reproduces the bug,
   citing the task id in the test name, and confirm it fails **for the right reason**. Then the
   minimum change to make it pass. Then refactor while green.
8. **Run the repo's gates** and fix regressions.
9. **Finish per your repo's rule** — see its own `fixall.md`, since "done" differs.
10. **Post a completion report** (`add_comment`) and mark it complete
    (`update_task { taskId, completed: true }`). Say what it does in plain language, not by
    commit hash or task id.

**Never leave a red gate.** A failing test that looks unrelated is still a failing test — say
plainly that it is unrelated and why, rather than moving past it quietly.

**If a task is ambiguous or needs a product decision, hand it back** and move to the next one.
Do not guess at intent, and do not stall the whole run on one blocked task.

**If the same task fails twice**, stop working it, comment with what was tried and why it
failed, and move on.

---

## When the fix belongs to the other repo

Some bugs cannot be fixed where they are reported. The 30-day sign-out was one: only the server
could issue a fresh token, so no amount of Swift would have helped.

**File that half on the other board** — Astrid Web To-do `a623f322-4c3c-49b5-8a94-d2d9f00c82ba`,
Astrid iOS To-do `aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36` — and say on the original task that you
have done so. A task parked on the wrong board is invisible to the loop that works that board:
it just sits, and every re-run reports it as blocked. That is exactly what happened with the
session bug, which idled for a full cycle before anyone noticed the work belonged elsewhere.

```
create_task { listId: "<target board id>", title: "[web] <what the other side must do>",
              priority: 3, description: "<contract, evidence, and what this side does once it exists>" }
```

(`get_tasks { listId }` first, so a re-run does not file the same title twice.)

**What that task must contain**, because whoever picks it up will not have your context:

- **The evidence**, with the commands to re-run it. "iOS gets signed out" is a report;
  "`mobile-session` returns 401 once `exp` passes and no route emits `Set-Cookie`" is a finding
  someone can act on.
- **The contract needed** — the exact field, where it appears, and when. Say what absence means,
  since that is the case that gets mishandled.
- **What the other side will do once it exists**, so the halves are designed together rather
  than negotiated after the fact.
- **Whether the halves can ship independently.** Usually yes if the new field is optional — say
  so explicitly, because it decides whether anyone has to coordinate a release.

**Then keep the original honest.** Do the half you can and say plainly what remains. Do not
close a task while users are still affected. A merged branch is not a deployed one: astrid-web
does not auto-deploy, so `main` having the fix changes nothing until someone deploys.

---

## After every task, re-check the list

```
get_agent_queue { agent: "<current harness mailbox>", listId: "<board id>" }
```

**Never work from the opening snapshot.** New tasks arrive while work is in progress, and a
REOPENED task looks exactly like one that was never done. Re-check with the SAME call you opened
with — a direct-DB read applies neither the board nor the assignee filter, so re-checking that
way hands back work that was deliberately scoped out, including tasks someone has claimed
since the run began.

A reopened task means the previous fix missed. Re-read it and find a different cause rather
than re-closing it on the same reasoning.

**When the list is empty**, summarise in a few lines: what was done, and anything skipped and
why.
