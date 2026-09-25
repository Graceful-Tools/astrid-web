# Spec: "Waiting on tasks" — task-to-task blocking

*Spec of record for blocking dependencies between tasks. Task **AWTD-1002**.*

Status: **implemented** (2026-09-25, AWTD-1002) — `lib/task-dependencies.ts`,
`services/task-dependency.service.ts`, `app/api/v1/tasks/[id]/blockers/`,
`components/task-detail/TaskDetailBlockersRow.tsx`. One deviation, recorded where it is
made: the empty row renders for a user who can WRITE, because the "Add blocker…" task
action menu this spec assumed does not exist in this repo, and a feature reachable only
through a surface nobody built is not shipped. Companion to
[PROJECT_MODE.md](../product/PROJECT_MODE.md), which governs gating and scope, and to
[project-status-board.md](../product/project-status-board.md), which governs the board's
behaviour. This file governs **the relation, the promotion rule, and the surface**.

> The ask, in Jon's words: *"a task can be blocked on one or more other tasks being
> completed. If those tasks are completed and the 'when time' is complete, the task moves
> from Waiting to Ready. The task should be a search on tasks and it could be any number of
> other tasks but should be usable for 1–3 as the key number which is most common. But no
> hard coded numbers. This should only be for project / board mode. Otherwise this is
> hidden."*

---

## The one thing this spec is really about

**This behaviour already exists in this repo, twice, and neither copy is the product.**

1. `lib/ready-queue-scope.ts` parses a `BLOCKED-BY: <task-id>` line out of task *comments*
   and re-checks the blockers' completion on every `/fixall` run. It works, it is tested
   (`tests/lib/ready-queue-waiting.test.ts`), and it is invisible to every human being who
   is not reading agent documentation.
2. [PROJECT_MODE.md](../product/PROJECT_MODE.md) lists `blockedByTaskId` among the nullable
   columns that "render nothing" — a reservation for a feature nobody built.

So the risk here is not the schema. It is shipping a **third** description of one rule.
`docs/FIXALL_WORKFLOW.md` exists because two files describing one workflow had drifted by
440 lines; the same failure in *code* is worse, because a board that promotes a task and a
loop that refuses to take it look, from the outside, like the board is broken.

**Therefore: one promotion rule, one implementation, named here.** It is
`classifyWaitingTask` in `lib/ready-queue-scope.ts`, and
`tests/rules/blocking-spec-names-the-shared-promotion-rule.test.ts` fails if this document
and that function come apart.

### What happens to `blockedByTaskId`

**It is not built, and PROJECT_MODE.md's reservation is superseded by `TaskDependency`
below.** A scalar column says "at most one blocker", and the requirement is explicitly "one
or more … but no hard coded numbers" — a `1` hard-coded in the schema is still a hard-coded
number, and the migration away from it (backfill a join table, dual-read, drop the column)
costs more than starting with the relation. PROJECT_MODE.md's *rule* survives untouched:
the relation is empty for everyone who does not use it, and empty draws no pixels just as
effectively as null does.

---

## The model

```prisma
/// A task waits for another task to be completed (AWTD-1002).
///
/// A join row rather than a `blockedByTaskId` column on Task: "one or more
/// blockers, no hard-coded ceiling" is a relation, and the 1–3 that the UI is
/// tuned for is a fact about how people work, not a constraint the data may
/// assume. Rows exist only for tasks someone deliberately blocked, so the
/// feature costs an unused account nothing.
model TaskDependency {
  id              String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  /// The task that is held up.
  blockedTaskId   String
  /// The task it is waiting for.
  blockingTaskId  String
  createdAt       DateTime @default(now())
  createdById     String?

  blockedTask     Task     @relation("TaskBlockedBy", fields: [blockedTaskId], references: [id], onDelete: Cascade)
  blockingTask    Task     @relation("TaskBlocks",    fields: [blockingTaskId], references: [id], onDelete: Cascade)
  createdBy       User?    @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@unique([blockedTaskId, blockingTaskId])
  @@index([blockingTaskId])
}
```

Four details that are load-bearing:

- **`@@unique([blockedTaskId, blockingTaskId])`** — adding the same blocker twice is a
  no-op, not a duplicate chip. Sync, MCP, iOS and the web UI all write here, so "the same
  write arrived twice" is the normal case, not an edge one (the same reasoning as
  `Project.nextSequence`).
- **`@@index([blockingTaskId])`** — the reverse direction is the *hot* one. Completing a
  task asks "what did I just unblock?", and that runs on every completion in the product.
- **`onDelete: Cascade` on both sides** — deleting a task must not leave a dependent
  waiting on a row that no longer names anything. Note the asymmetry with subtasks
  (`parentTaskId` is `SetNull`, so subtasks promote rather than vanish): there, the child is
  real work that survives its parent; here, the *relation* is the only thing being deleted.
- **`createdById` is `SetNull`, not cascade** — a departing user must not silently unblock
  the team's tasks.

**`TaskDependency` is not subtasks and must not become them.** A subtask is *part of* its
parent; a blocker is *before* its dependent. They will be confused, so the copy never says
"parent" and the model never reuses `parentTaskId`.

---

## The promotion rule

**Both conditions, one gate.** A task leaves `Waiting` for `Ready` when:

1. **Every** blocker is completed (`completed = true`, whatever `closedReason` says — a
   blocker closed as `canceled` or `duplicate` is still not going to happen, and leaving its
   dependent stuck forever is the worse failure), **and**
2. its own **`dueDateTime` has arrived**, or it has no date at all.

Either alone leaves it in `Waiting`. That is exactly what `classifyWaitingTask` already
returns — `check-blockers` while blockers remain, `hold` while the date is in the future,
`promote` only when both are clear — and the implementation of this feature **calls that
function** rather than restating the rule:

```ts
import { classifyWaitingTask } from '@/lib/ready-queue-scope'
```

Its ordering comment already explains why blockers are checked before the date: *"a blocked
task's date (if any) is a recheck cadence, not a start time."* That reading holds for the
product feature too, and it is why the date does not need a second "start date" field —
`dueDateTime` is the "when time" the ask names.

> **Assumption stated explicitly, because it is the one place the ask is ambiguous.** "The
> when time" is read as the task's existing `dueDateTime` (with `isAllDay` meaning the start
> of that day, per `isDueToStart`). A separate *start* date, distinct from the due date, is
> a bigger change to the product's date model than this feature should make on its own — see
> [DATE_HANDLING_SPECIFICATION.md](../DATE_HANDLING_SPECIFICATION.md). If Jon wants a start
> date, that is its own task and this feature reads it instead with a one-line change.

### Where promotion runs

Two triggers, one function — `promoteUnblockedDependents(taskId)`:

| Trigger | Where | Why it is needed |
|---|---|---|
| A blocker is **completed or deleted** | inside `updateTaskWithSideEffects` / the delete path in `services/task.service.ts` | The user's own completion should unblock the next card **while they are looking at the board**, not up to a minute later. |
| The **clock** reaches a dependent's date | `/api/cron/reminders` (already runs `* * * * *` and already carries `processAgentTasksDueSoon`) | Nothing happens to a task when its own date arrives; something has to notice. |

Both paths re-evaluate the whole condition rather than trusting the trigger, so a task
blocked by three tasks completed in any order — or completed while the cron was failing —
lands in the same state. **The gate is idempotent and the write is conditional**: promote
only a task whose `statusRole` is still `waiting`. A task somebody has since dragged to
`Doing`, completed, or parked in a project's custom state is not the promoter's to move.

### Reopening a blocker

Reopening a blocker **re-blocks its dependents, but only out of `Ready`.**

- Dependent in `Ready` → back to `Waiting`. It was only in Ready because the blocker was
  done, and that is no longer true.
- Dependent in `Doing`, `Done`, or a custom state → **left alone**, with a `TaskEvent` and a
  notification to its assignee. Yanking a card out from under someone mid-work is worse than
  a stale lane, and they are the only one who can judge whether the reopened blocker
  actually stops them.

This mirrors `resolveCompletionStatusTransition`'s existing instinct in `lib/task-status.ts`
— *"a person reopening their own task has a board in front of them, so moving their card for
them would be presumptuous."*

### Cycles

**A write that would create a cycle is refused: `409` with `reason: "dependency_cycle"`.**
Not tolerated-and-ignored, and not detected later by the promoter — a cycle is a set of
tasks none of which can ever be promoted, so tolerating one ships a silent deadlock that
looks like a bug in the board.

Detected at write time by walking `blockingTaskId` edges up from the proposed blocker,
depth-first with a visited set, and refusing if the blocked task is reachable. Self-blocking
(`blockedTaskId === blockingTaskId`) is the depth-0 case of the same check. The walk is
bounded by the visited set, not by a depth constant — *no hard coded numbers*.

---

## Permissions and visibility

Blockers cross list boundaries, so the permission question is real and has two halves:

- **Writing a dependency** requires write access to the **blocked** task and *read* access
  to the **blocking** one, both through `lib/list-permissions.ts` — never an inlined
  `ownerId === user.id`, per [CODE_REUSE_AND_CONSISTENCY.md](../CODE_REUSE_AND_CONSISTENCY.md).
  Read access on the blocker is enough: pointing at a task is not modifying it.
- **Reading a dependency you can only half see** renders the chip as **"1 blocker you can't
  see"** with no title, no identifier and no link. The count is not a leak (the reader
  already knows *something* is holding their task); a title is. The picker's search already
  filters by `listVisibilityWhere`, so this state arises from a task being *moved* or
  *unshared* after the link was made, not from the picker.

**A blocker you cannot see still blocks.** The alternative — treating invisible blockers as
satisfied — promotes work that is genuinely not ready and does it *because* of a permission
boundary, which is the worst possible reason.

---

## The surface

### Gating: three layers, then a fourth

The first three are [PROJECT_MODE.md](../product/PROJECT_MODE.md)'s, unchanged and checked
through `lib/project-mode.ts`: the `projectMode` capability, the `project_mode` flag, and
shared-board disclosure. The API refuses server-side (`projectModeGate`); hiding the row
while leaving `POST /api/v1/tasks/:id/blockers` reachable is not a configuration option.

The fourth is this feature's own visibility rule, and it belongs in
`lib/task-detail-project-state.ts` beside `showsTaskDetailProjectState` — one shared
predicate, stated once, so iOS and Mac copy it rather than re-deciding it:

```ts
export function showsTaskBlockers({ isInProject, isReadOnly, hasBlockers }: …): boolean
```

- **On a board only.** Blocking is a board idea; `isTaskInProject` is the whole design, for
  the reason that module already gives.
- **Read-only viewers see chips, not controls** — unlike the board-state row, which is a
  mover and hides entirely. A public-list reader benefits from knowing a task is blocked.
- **Zero blockers renders nothing.** The row appears when there is something to show, or
  from the task action menu ("Add blocker…"). No empty-state row on every task on every
  board.

### The picker is a search

`GET /api/v1/search` already does server-side, permission-filtered task search with
`ILIKE` over titles, descriptions and comments, paginated, with `listVisibilityWhere`
applied **in the query**. The picker uses it. It does not grow a second search path, and it
does not filter client-side over loaded tasks — that is the bug task `5df85b9f` fixed.

Three filters the picker adds on top, and nothing else:

- **Exclude the task itself** and anything that would cycle (the same walk as the write
  check, so the user is never offered a choice that will be refused).
- **Exclude tasks already linked**, so the list shows what you can add.
- **Rank tasks on the same board first.** Most blockers are neighbours; ranking is not
  filtering, so a cross-board blocker is still one search away.

### 1–3, without a 3 anywhere

The ask is "usable for 1–3, which is most common, but no hard coded numbers". Those are
compatible because **1–3 is a layout target, not a limit**:

- Chips **wrap**; the row grows. There is no `slice(0, 3)`, no "+2 more", no `MAX_BLOCKERS`.
- The row is *designed* so that one to three chips read at a glance — which is what "usable
  for 1–3" asks for — and ten chips look like ten chips, which is honest and rare.
- The picker is multi-select and stays open between picks, because adding two or three in a
  row is the common case and reopening it three times is the friction being avoided.
- `getTasksBlocking(taskId)` and `getTasksBlockedBy(taskId)` return arrays, are paginated by
  the standard envelope, and assume nothing about length.

**Nothing in schema, API, or UI may encode a blocker count.** The ratchet for this is a grep
in the implementation task's test, in the style of `tests/rules/`.

### Copy and activity

- Every user-facing string is an i18n key (`tasks.blockers.*`), never a literal.
- Three new `TASK_EVENT_KINDS` in `lib/task-events.ts`: `blocker_added`, `blocker_removed`,
  `unblocked`. `unblocked` is the one that matters — "why did this move to Ready at 4am?"
  is precisely the question `TaskEvent` exists to answer, and an automatic promotion with no
  trail is the agent-autonomy trust problem that model comment describes.
- `unblocked` notifies the dependent's assignee via the existing `TaskEvent` fan-out. It
  writes no new notification path.

---

## Reconciling the agent convention

Once `TaskDependency` exists, **the rows are the source of truth** and the
`BLOCKED-BY:` comment marker becomes a *write shorthand*, not a parallel system:

- `scripts/ready-tasks.ts` reads structured dependencies **unioned with** parsed
  `BLOCKED-BY:` markers, so no currently-parked task silently comes unblocked on the day
  this ships.
- `parseBlockedConditions` stays exactly as it is. A harness with no API for this — or a
  human typing on their phone — can still block a task with a comment.
- A follow-up (not this spec) may have the marker *create* the row, at which point the union
  collapses back to one read. It is deliberately not in the first cut: the parse is the
  fallback that makes the first cut safe.

`BLOCKED-ON:` (an external event) is untouched. It has no task to point at, so it stays a
comment marker re-checked by a human or an agent, exactly as
[FIXALL_WORKFLOW.md](../FIXALL_WORKFLOW.md) describes.

---

## API

All four gated by `projectModeGate`, all returning the standard v1 envelope. Any wire change
updates `lib/api-contracts/v1-ios-shapes.ts` and `tests/api/v1-contract.test.ts` in the same
PR, per PROJECT_MODE.md's working agreements.

| Route | Does |
|---|---|
| `GET /api/v1/tasks/:id/blockers` | Both directions: `{ blockedBy: [...], blocks: [...] }`. Invisible blockers appear as `{ hidden: true }` with an id only. |
| `POST /api/v1/tasks/:id/blockers` | `{ blockingTaskId }`. `409 dependency_cycle`, `403` on permissions, `200` (not 201) on an existing link — the unique constraint makes it idempotent. |
| `DELETE /api/v1/tasks/:id/blockers/:blockingTaskId` | Removes one link. Re-runs the promotion gate: removing the last outstanding blocker unblocks the task, same as completing it would. |
| `GET /api/v1/tasks/:id` | Gains `blockedBy` / `blocks` id arrays. **Optional fields**, so iOS and web ship independently. |

**The halves ship independently.** The fields are additive and optional; an iOS client that
has never heard of them is unaffected, and the server does not wait for a client release.

---

## What this is explicitly NOT

Per PROJECT_MODE.md's *"if a Project Mode task starts growing toward one of these, stop and
re-scope it"*:

- **A relation taxonomy.** Linear has `blocks / blocked-by / relates-to / duplicates`. This
  is *one* relation with a direction. "Relates to" is a link with no behaviour, and this
  feature is entirely behaviour.
- **Gantt charts, critical paths, or auto-scheduling.** No dates are computed from
  dependencies. A blocker holds a task; it does not move its date.
- **Cross-account blocking.** Permissions above are read/write checks within what the user
  can already see.
- **Blocking on anything but a task.** A PR, a deploy or a vendor fix is `BLOCKED-ON:`, and
  that is already solved.

---

## Sequencing

Small enough to be four tasks, in this order; each is shippable alone.

1. **Schema + the gate.** `TaskDependency`, its migration, `promoteUnblockedDependents`
   calling `classifyWaitingTask`, the cycle check. No UI. RED test: a task with an
   outstanding blocker is not promoted when its date arrives.
2. **API.** The four routes above, `projectModeGate`, contract shapes, `v1-contract.test.ts`.
3. **UI.** The blockers row, the search picker, `showsTaskBlockers`, i18n keys, the
   no-hard-coded-count ratchet.
4. **Reconcile the loop.** `scripts/ready-tasks.ts` unions structured rows with parsed
   markers; update [FIXALL_WORKFLOW.md](../FIXALL_WORKFLOW.md)'s Waiting table to name the
   rows as primary.

## Working agreements

Inherited from PROJECT_MODE.md and not restated: TDD with the task id in the test name,
schema changes ship with their migration in the same PR, permissions through
`lib/list-permissions.ts`, all copy through i18n, `npm run check:reuse`, and every
`brands/` profile passing `npm run check:brands` with `projectMode` off.

## Open question for Jon

One, and only one, because it changes the model rather than the implementation:

**Should a blocked task be *moved* to `Waiting` automatically when a blocker is added?**
This spec says **yes** — adding a blocker to a `Ready` task demotes it to `Waiting`,
because Ready means "actionable now" (Jon, 2026-08-29) and a blocked task is not. But it
also means dropping a blocker on someone's card moves it, which is the mirror image of the
reopen case where this spec argues *against* moving people's cards. The distinction is that
adding a blocker is a deliberate statement about *this* task, while reopening a blocker is a
statement about a different one — thin enough that it is worth confirming.

A `Doing` task that acquires a blocker is **not** moved, either way.
