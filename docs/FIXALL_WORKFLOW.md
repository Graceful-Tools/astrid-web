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

## One session per working tree — take the lock first

**Before anything else, including reading the queue:**

```bash
npx tsx scripts/fixall-session.ts acquire --pid $PPID --harness <claude-code|github-copilot|codex>
```

Exit `0` means the tree is yours. **Exit `2` means another live session is already
running `/fixall` here — stop, and do not read the queue.** Start again from your own
worktree (`npm run work:start <task-slug>`), which is the arrangement this is steering
you toward rather than away from: parallel runs are good, sharing a checkout is not.

`$PPID`, not the script's own pid. In an agent's shell that is the harness session
itself, so the lock lives exactly as long as the run and clears itself if the session
is killed. Staleness is decided by whether the holding process is alive, never by an
age limit — a run can legitimately sit on one hard task for a long time, and a lock
that expires under a working session is worse than no lock.

Release when the run ends: `npx tsx scripts/fixall-session.ts release --pid $PPID`.
`status` says who holds the tree and whether they are still alive.

### Why this exists, and why the board lanes do not cover it

On 2026-09-09 two Claude Code `/fixall` sessions ran in one checkout. The second
created a branch, moving `HEAD` while the first had six files uncommitted, and both
then wrote the same fix for AWTD-865. Neither noticed until a `git status` returned
files nobody in that session had touched.

`Ready` → `Doing` claims a **task**. It says nothing about which **working tree** is
being edited — and two sessions working two *different* tasks in one checkout corrupt
each other just as thoroughly. The lanes and the lock answer different questions;
neither substitutes for the other.

---

## The queue

**Read and write tasks through the `astrid` MCP server** — the LOCAL stdio server
(`node ../astrid-web/mcp/astrid-mcp-launch.js`), not scripts and never the database
(Jon, 2026-08-29: the DB is for deep repair only).

Not the hosted `https://www.astrid.cc/mcp` transport, which this document used to name. It is
authorization-code OAuth, a scheduled run has no browser to complete it in, and every unattended
run therefore reported `ConnectionRefused` (2026-09-13). stdio authenticates from the
client-credentials pair in `astrid-web/.env.local` and needs nobody present.

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

**Starting → claim it**, before the strategy comment, so the window where the board is
wrong is as small as possible:

```bash
cd ../astrid-web && npx tsx scripts/claim-fixall-task.ts <taskId> ready --agent <mailbox>
```

The claim is a single conditional update: it requires the task to still be `Ready` and
writes `Doing` in the same statement, so of two simultaneous claims exactly one
succeeds and the other is told `CLAIM_CONFLICT` (exit 2). Reading the queue and then
writing the status as two steps leaves a window between them, and that window is wide
enough — it is how two sessions came to work AWTD-865 at once.

`--agent` is not optional for a local harness. Omitted, the claim assigns to **Copilot**,
because the GitHub Actions worker calls this with positional arguments only and that
default has to keep meaning what it always did. A Claude Code loop that omits it hands
its own work to a different harness.

`set-task-status.ts` remains the right tool for the OTHER transitions below — moving a
task to `Waiting`, or handing it back. It is only the *claim* that has to be atomic.

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

1. **Claim it atomically** — this both takes the task and moves it to `Doing`:

   ```bash
   npx tsx scripts/claim-fixall-task.ts <taskId> ready --agent <claude|copilot|codex>
   ```

   Exit `0` is yours. **Exit `2` (`CLAIM_CONFLICT`) means another session got there
   first — skip to the next task without comment.** That is an ordinary outcome of
   two loops sharing a board, not a failure.
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

## After every task, re-check the queue AND the inbox

```
get_agent_queue { agent: "<current harness mailbox>", listId: "<board id>" }
```

**One call answers both questions.** `queue` is what to work; `attention` is what has been said
to this agent and not answered (AWTD-963). Read them at the top of every run and again after
every task — the inbox is part of the run, not a courtesy at the end of it.

**Never work from the opening snapshot.** New tasks arrive while work is in progress, and a
REOPENED task looks exactly like one that was never done. Re-check with the SAME call you opened
with — a direct-DB read applies neither the board nor the assignee filter, so re-checking that
way hands back work that was deliberately scoped out, including tasks someone has claimed
since the run began.

A reopened task means the previous fix missed. Re-read it and find a different cause rather
than re-closing it on the same reasoning.

**When the list is empty**, push, then post the run summary into the board's list chat — see
*The engagement contract* below for where each kind of thing goes and how to write it.

## The engagement contract — where an answer goes

The loop could always talk to the board. Until AWTD-963 it could not hear it: `queue` is
Ready ∩ assigned ∩ due, so a comment on a task the agent itself moved to `Doing` was invisible,
a comment on one it had finished was invisible, and list chat had no read path at all. Polling
mode disables the server-side dispatch sites deliberately, so the harness has to PULL what the
server no longer pushes.

Now that it can, these are the rules for answering, in one place rather than in each repo's own
file.

**Read the inbox with the queue.** `attention.tasks` is every task assigned to this agent — in
ANY state, completed included — whose newest authored comment is from a human.
`attention.messages` is list-chat replies since the agent last spoke. Both arrive on the call
that already reads the queue, so a quiet tick still costs one HTTP request.

The scheduled runner (`scripts/fixall-loop.sh`) reads that same call *before* starting a session
— through its queue-status guard, which also runs the lane sweep — and starts one only for a
Ready task, a new inbox item, or RECHECK/REVIEW work. An inbox item wakes **one** run:
if that run chooses not to answer it, the same comment never wakes another, a new comment does.
So an idle board costs no tokens at all, and an unanswered "thanks" cannot become a session
every half hour.

Two fields say what the inbox could not see, and neither should be read as silence:

- `attention.truncated` — more is waiting than one poll reports.
- `attention.skipped` — a half that was not read, and why. The chat half needs `chat:read`; a
  connection provisioned before chat scopes existed does not carry it until its scope group is
  adopted in Settings → Connections (AWTD-962). An unread channel and a quiet one are different
  facts.

**Answer on the task.** Never in the terminal. *"A summary that only exists in a terminal is
gone as soon as the window is"* (Jon, 2026-09-15). **This holds for a WATCHED run too** — the
board is where Jon looks, from whichever device is to hand, and a run he watched on Monday is
one he cannot re-read on Tuesday. `add_comment { taskId, content, type: "MARKDOWN" }`.

**Run summaries go to the board's list chat, silently.**

```bash
cd <astrid-web> && npx tsx scripts/post-list-message.ts <boardListId> "<summary>"
```

A few lines of run-level news — what was pushed, what was skipped, what failed. Per-task detail
stays on the tasks as completion comments and is not repeated here. One build now carries
several tasks, so those comments are the only place the detail for a single task exists.

No `@`-mentions: a mention is the one thing that fires a push notification, and a scheduled run
must not be pushing notifications at whatever hour it happens to run.

**Post only when something happened.** A skipped run, a held lock and an empty queue are not
news; they go to the run log and no further. A loop that announces every quiet tick buries the
messages that matter.

**Write for the phone.** iOS renders inline markdown only, so `##` headings, `-` bullets and
fenced code blocks come out literally. Use `**bold**` labels, `•` bullets and plain newlines.
Image syntax — an exclamation mark, the task title in square brackets, the task id in
parentheses — renders as a tappable link to that task, so name tasks by title and still give a
way through to them.

**Anything needing a DECISION escalates to a person, and there is only one path that reaches
one.** Assign the task to Jon AND post the question as a comment on it — both, for the reason
the Waiting section already gives, and because `fanOutComment` in `lib/notifications.ts`
notifies the assignee, the creator and the participants, while a list-chat message notifies
nobody who was not mentioned. A decision left in the run summary reaches no one.

So the three destinations are not interchangeable:

| What | Where | Who sees it |
|---|---|---|
| The answer to a comment, and per-task detail | a comment on that task | assignee, creator, participants — notified |
| The run's news — what was pushed, skipped, failed | the board's list chat | anyone who opens the board; nobody is notified |
| Whether the run happened at all | one `RESULT:` line in the terminal | whoever is watching, if anyone |

`RESULT: OK — <n> tasks`, `RESULT: SKIPPED — <why>`, `RESULT: FAILED — <why>`. Nothing else goes
to the terminal.

## Pushing is part of finishing (Jon, 2026-09-06)

**Do not ask permission to push.** *"I want to look at work when you are done. I don't want to
tell you to push it so I can look at it and then wait."* An empty queue ends with the work
pushed, so it is already reviewable — a TestFlight build building on iOS/Mac, `main` updated on
web — and the summary posted to the list chat says what went out.

Two things this does NOT change:

- **Push once, at the end of the run, not per task.** The batching is the point: on iOS a push
  per fix exhausted the Xcode Cloud allotment on 2026-08-18, after which every run was created
  and cancelled before it started. One build carries several tasks, so the completion reports
  have to carry the per-task detail.
- **Anything that reaches real users still waits for an explicit go-ahead** — an App Store
  submission on iOS/Mac (or a local `:upload`), a production deploy on web. Pushing is not
  shipping in either repo, which is exactly why pushing needs no permission and shipping does.
