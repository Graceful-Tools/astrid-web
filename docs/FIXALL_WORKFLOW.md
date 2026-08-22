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

```bash
cd ../astrid-web && npx tsx scripts/ready-tasks.ts <web|ios> --harness <name>
```

Prints `READY_EMPTY`, or the queue in the order to work it: priority high → low, then oldest
first. Valid harnesses: `claude-code`, `github-copilot`, `codex`, `astrid-server`.

**One script, both loops**, so the guarantees are the same for each. A second implementation
would drift, and the drift would be silent — a queue that is wrong looks exactly like a quiet
day.

A task is yours only when **all four** hold:

1. **On the board** named for this loop. `Ready` is account-wide and shared by every board, so
   filtering on it alone would hand the web loop iOS work and put two agents in one repo.
2. **Ready status.** The rest of the board is filed but not triaged. Working anything else is
   not autonomy, it is picking your own work.
3. **Unassigned or assigned to this harness.** Unassigned Ready tasks are claimable by this loop.
   Assignment is still a claim for tasks that already have an owner, so tasks assigned to someone
   else remain out of scope.
4. **Due now.** See below.

The script prints what it skipped and why, with the assignee's name, so a queue held up by
someone else's work never looks like an idle one. If something is genuinely yours, say so and
let Jon assign it; do not work around the filter.

### A task with a date waits for its date

Jon, 2026-08-19: *"If a task has a date don't start until the date or time of the task.
Therefore we can have fixall respond to recurring tasks and track them in Astrid."*

Anything whose `dueDateTime` is still in the future is held and listed with when it comes due,
so a queue waiting on the clock is visibly different from an idle one:

```
(1 Ready task(s) scheduled for later — not yet due:)
  — Weekly dependency audit  [due 2026-08-23 09:00 UTC]
```

**This is how recurring work runs.** Completing a repeating task rolls it forward to its next
occurrence — `RepeatingTaskCalculator` already does that — and the date gate holds it until
that moment arrives. So a recurring chore leaves the queue when it is finished and comes back
by itself when it is due. The schedule lives in Astrid, where Jon can see and change it from
his phone, rather than in a cron file or in this document. To make something recurring, give
the task a date and a repeat in Astrid; nothing in the loop needs to change.

- **No date** → workable now. That is every task the loop took before this existed.
- **All-day** → workable from the start of its day, since an all-day task carries midnight.
- **Unreadable date** → treated as *no date*, never as "never". Stranding a task on a value
  nobody can see would look exactly like an empty queue, every run, with nothing saying why.

If the queue is empty but something is scheduled, say when the next one comes due rather than
just "empty" — a quiet run and a finished one are different things.

---

## Say on the board what you are doing

The board is where Jon looks. A task being worked and a task nobody has touched must not look
identical there.

**Starting → move it to `Doing`**, before the strategy comment, so the window where the board
is wrong is as small as possible:

```bash
npx tsx scripts/set-task-status.ts <taskId> Doing
```

**Blocked on Jon → hand it back: assign to him AND move it to `Waiting`.** Both, not one.
Assigning alone leaves it in Doing, which reads as in-progress; moving alone leaves it assigned
to the agent, which reads as still yours:

```bash
npx tsx scripts/assign-task.ts <taskId> jonparis@gmail.com
npx tsx scripts/set-task-status.ts <taskId> Waiting
```

Then say on the task what decision you need. A task in `Waiting` with no question on it is just
a task nobody is working. The point of `Waiting` is that a re-run stops re-reading it — a
blocked task left in Ready is re-examined every fifteen minutes forever and reported as blocked
every time, which is the no-op loop this workflow exists to avoid.

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
3. **Read the description AND the comments/attachments.** A screenshot attached to the task is
   usually the fastest route to the real cause.
4. **Check where the fix actually lives before writing any.** If it belongs to the other repo,
   file it there NOW (below) rather than discovering it three steps later.
5. **Post a short strategy comment** before writing code.
6. **One branch per task**, `fix/<short-description>`.
7. **RED-GREEN TDD, mandatory for bug fixes.** Write a failing test that reproduces the bug,
   citing the task id in the test name, and confirm it fails **for the right reason**. Then the
   minimum change to make it pass. Then refactor while green.
8. **Run the repo's gates** and fix regressions.
9. **Finish per your repo's rule** — see its own `fixall.md`, since "done" differs.
10. **Post a completion report** and mark it complete. Say what it does in plain language, not
    by commit hash or task id.

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

```bash
cd ../astrid-web
cat > /tmp/other-half.json <<'JSON'
[{ "title": "[web] <what the other side must do>", "priority": 3,
   "description": "<contract, evidence, and what this side does once it exists>" }]
JSON
ASTRID_IOS_LIST_ID=<target board id> \
  DATABASE_URL="$DATABASE_URL_PROD" npx tsx scripts/create-ios-tasks.ts /tmp/other-half.json
```

(The script reads its list from `ASTRID_IOS_LIST_ID` despite the name, so overriding it targets
either board. It skips titles that already exist, so re-running is safe.)

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

```bash
cd ../astrid-web && npx tsx scripts/ready-tasks.ts <web|ios> --harness <name>
```

**Never work from the opening snapshot.** New tasks arrive while work is in progress, and a
REOPENED task looks exactly like one that was never done. Re-check with the SAME filtered
script you opened with — the direct-DB alternative applies neither the board nor the assignee
filter, so re-checking with it hands back work that was deliberately scoped out, including
tasks someone has claimed since the run began.

A reopened task means the previous fix missed. Re-read it and find a different cause rather
than re-closing it on the same reasoning.

**When the list is empty**, summarise in a few lines: what was done, and anything skipped and
why.
