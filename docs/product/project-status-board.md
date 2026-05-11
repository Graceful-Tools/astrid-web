# Project Status Boards

## Goal

Add an optional project layer that lets teams and agents work through a simple board without turning Astrid into a heavyweight issue tracker.

The core model is:

```text
Project = shared context for related lists, members, and statuses.
Lists = regular task membership. A task can be in many lists.
Status = special list membership for the in-progress states (Ready, Doing, Waiting).
Inbox = a task in a project list that has no status assigned.
Done = Astrid's existing completed task state.
```

Inbox and Done are **virtual** columns derived from task state. They are not real lists — no membership row exists for them, so a task is never "in" Inbox or Done at the storage layer.

## Default Statuses

When a board is enabled for a project, three real status lists are created:

| Status | Default subtitle |
| --- | --- |
| Ready | Time to get to work! |
| Doing | Active work in progress! |
| Waiting | Paused until the circumstances are right. |

The virtual columns:

| Column | Default subtitle |
| --- | --- |
| Inbox | Move them to "Ready" when they are... ready! |
| Done | Complete — congrats! |

These are defaults, not a rigid methodology. Project owners can rename and reorder statuses or add custom non-Done statuses. Inbox and Done are always present as the first and last columns and cannot be removed or renamed.

## Membership Rules

Regular lists are additive:

```text
Task: Fix repeating rollover
Lists: Astrid iOS To-do, Bugs
```

Status lists are mutually exclusive inside a project:

```text
Status: Ready
```

Moving the task from Ready to Doing removes Ready and adds Doing. Regular lists stay attached.

```text
Before: Astrid iOS To-do + Bugs + Ready
After:  Astrid iOS To-do + Bugs + Doing
```

## Inbox and Done Derivation

Inbox and Done are derived from the task's state, not stored as memberships.

```text
Inbox  = completed = false AND no project-status list is attached
Done   = completed = true
Status = completed = false AND exactly one project-status list is attached
```

Invariants enforced by the API:

```text
completed = true  =>  no project-status list memberships
status set        =>  completed = false
```

Moving a task to the Done column sets `completed = true` and strips any status. Moving a task out of Done (to Inbox or any status) sets `completed = false`. Moving a task to the Inbox column strips its status without changing other list memberships.

## Project Views

A project can contain domain lists and status lists.

```text
Project: Astrid Development

Lists
- Astrid iOS To-do
- Astrid Web To-do
- Astrid Biz To-do

Statuses
- Ready
- Doing
- Waiting
```

This supports:

- View all iOS tasks.
- View all Ready tasks across Astrid Development.
- View all iOS tasks that are Ready.
- Use a board with Inbox / Ready / Doing / Waiting / Done columns across the whole project or a selected domain list.

## Board Behavior

Board columns, in order:

1. **Inbox** (virtual) — project-domain tasks with no status and `completed = false`.
2. **Ready, Doing, Waiting** (real status lists) — and any custom non-Done statuses.
3. **Done** (virtual) — project-domain tasks with `completed = true`.

Dragging a card:

- **To a status column**: keep regular list memberships, replace any existing status with the target, ensure `completed = false`.
- **To Inbox**: keep regular list memberships, strip every status from this project, ensure `completed = false`.
- **To Done**: keep regular list memberships, strip every status from this project, set `completed = true`.

The board is editable:

- Rename status lists.
- Reorder status lists.
- Update status descriptions.
- Add custom non-Done statuses.

Inbox and Done are fixed: they cannot be renamed, reordered, or removed.

## Enabling and Disabling

A list with no project shows a **Create Board** action in its admin settings. Clicking it creates a project for the list and seeds the three default status lists. Multiple regular lists can later be attached to the same project.

A list connected to a board shows a **Disable Board** action. Disabling removes the project and its status lists. Domain lists are detached from the project (their tasks stay), and any task currently in a status loses that status. Completed tasks remain completed.

## Permissions

Project members should be inherited by project lists and statuses. The first web implementation can keep existing list membership checks and physically attach members to lists. The longer-term model should resolve access through project membership when `projectId` is present.

## Agent Rules

Agents should use the same human-readable buckets:

- New uncertain work stays in Inbox (no status assigned).
- Clear work ready to pick up goes to Ready.
- Active work goes to Doing.
- Work needing input, another task, a date, or external action goes to Waiting.
- Finished work goes to Done by using the existing completion path.

Agents must not create a task that is `completed = true` while still attached to a status list, and must not attach a task to multiple status lists in the same project.

## Shipping Status (2026-05-10)

### Shipped
- `Project` / `ProjectMember` tables; `TaskList.projectId`, `listType`, `statusRole`, `statusOrder`, `statusDescription`, `statusCompleted` columns. Migration `20260510000000_add_project_status_boards`.
- `POST /api/projects` (create + seed Ready / Doing / Waiting), `GET /api/projects`, `DELETE /api/projects/[id]` (detach domain lists then cascade-delete the project and its status lists).
- "Create Board" / "Disable Board" actions in list admin settings.
- Board view in the task manager: virtual Inbox + real statuses + virtual Done, drag-and-drop between columns with the spec's invariants enforced server-side via `normalizeProjectStatusListIds`.
- Board cards share `TaskRowContent` with the list view (identical row visuals), respect the list's `sortBy` / `manualSortOrder`, and use the compact `TaskHeader` (chevron-up + `…` menu, no "Task Details" label) when expanded inline.
- Default subtitles per the approved copy: Inbox / Ready / Doing / Waiting / Done.
- Tests: `tests/lib/project-status.test.ts`, `tests/lib/task-sort.test.ts`, `e2e/project-status-board.spec.ts`.

### Not Yet (tracked as follow-on work)
1. **Project picker / first-class Project entity in the UI** — `GET /api/projects` exists but no UI lists or opens projects directly. Today a "board" is just a list that has `projectId` set.
2. **Attach an existing project to additional regular lists** — current "Create Board" always creates a fresh project of one list.
3. **Project-level membership** — `ProjectMember` is in the schema but unused; permissions still resolve through `ListMember` on every list.
4. **Project-level views** — e.g. "all Ready across the project," "all iOS tasks that are Ready." Board today only scopes to the selected list.
5. **Rename / reorder / add-custom statuses UI** — fields exist on `TaskList` but no editor surfaces them.
6. **Edit project metadata** — `name`, `description`, `color`, `imageUrl` on `Project` are seeded once from the originating list and never updated.

These can ship incrementally after the v1 board lands.
