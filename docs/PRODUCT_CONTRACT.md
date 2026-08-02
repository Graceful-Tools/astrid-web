# Product Contract — shared behavior & copy across Web and iOS/Mac

*Single source of truth for the rules and user-facing strings that **both** the
web app (this repo) and the Apple app ([astrid-ios](https://github.com/Graceful-Tools/astrid-ios))
must honor, so the two platforms don't drift.*

Status: **v1** (2026-07-25). Companion to
[docs/CODE_REUSE_AND_CONSISTENCY.md](./CODE_REUSE_AND_CONSISTENCY.md) (§5 Phase 3).
API shapes live in [docs/context/api_contracts.md](./context/api_contracts.md);
this file governs *behavioral rules* and *copy*, not wire formats.

> Rule of thumb: if a change alters **who can do what** or **what words the user
> sees**, and it should look the same on both platforms, update this file in the
> same PR.

---

## 1. Permission matrix (the canonical rules)

Web's single source of truth is `lib/list-permissions.ts`
(`getUserRoleInList` → `owner | admin | member | viewer | null`, then the
`canUser*` helpers). iOS must implement the **same** decisions. Never re-derive
these inline per call site (that's how Web drifted — see the reuse doc).

Role resolution (`getUserRoleInList`): **owner** (list owner, by `ownerId`, the
`owner` relation, or the legacy `admins` array) → **admin** / **member** (via
`listMembers`) → **admin** / **member** (via the list's **project**, task
6c20d125) → **viewer** (any user on a `PUBLIC` list) → **null** (no access).

**Project membership cascades** to every list in the project, including its
status lists. Three rules iOS must mirror exactly:

1. **The higher role wins.** A list admin who is only a project member stays an
   admin — project membership can never *demote* someone.
2. **The project owner resolves to `admin`, not `owner`.** `owner` is the only
   role that can delete a list; owning the project must not grant the power to
   delete a list somebody else owns and merely attached to it.
3. **A project member is never downgraded to `viewer` on a PUBLIC list.** They
   are a real collaborator, not a passer-by.

An absent `project` relation means **"not loaded"**, never "no project access".
Any query backing a permission check must include it (`PROJECT_ACCESS_INCLUDE`),
or project members silently lose access. Visibility is derived from the same
definition via `listVisibilityWhere`, so a role can never be granted for a list
the query won't return.

| Capability | Owner | Admin | Member | Viewer | Helper |
|---|---|---|---|---|---|
| View list & tasks | ✅ | ✅ | ✅ | ✅ | `canUserViewList` |
| Add / edit tasks | ✅ | ✅ | ✅ | ⛔¹ | `canUserEditTasks` |
| Edit a specific task | ✅ | ✅ | ✅² | own only³ | `canUserEditTask` |
| Manage list settings | ✅ | ✅ | ⛔ | ⛔ | `canUserManageList` |
| Manage members | ✅ | ✅ | ⛔ | ⛔ | `canUserManageMembers` |
| Delete list | ✅ | ⛔ | ⛔ | ⛔ | `canUserDeleteList` |

Public-list nuances (encoded in the helpers — mirror exactly):
1. **Viewers can add tasks only on `collaborative` public lists**; on `copy_only`
   (the default) they cannot — they get the *Copy List* action instead.
2. On `copy_only` public lists, members edit; on private lists, members edit.
3. On `collaborative` public lists, a task is editable only by its **creator**
   (plus owner/admin).

Changing any cell here is a cross-platform change: update `list-permissions.ts`,
this table, and the iOS implementation together.

---

## 2. Copy-key registry (shared user-facing strings)

Both platforms already namespace strings the same way (`tasks.`, `lists.`,
`navigation.`, `settings.`, …) but use **different casing conventions**:

| | Web | iOS |
|---|---|---|
| Store | `lib/i18n/locales/<lang>.json` (base: `en.json`) | `Astrid App/Resources/Localizations/<lang>.lproj/Localizable.strings` |
| Convention | **camelCase** leaf (`tasks.addTask`) | **snake_case** leaf (`tasks.add_task`) |
| Lookup | `t("tasks.addTask")` | `NSLocalizedString("tasks.add_task", …)` |

**The mapping rule:** for a shared string, the group is identical and the leaf is
the same words with the platform's casing — Web `tasks.taskName` ⇄ iOS
`tasks.task_name`. When you add a shared string, add it to **both** stores under
the mapped names in the same change (or the follow-up iOS PR), and note it here
if it's non-obvious.

Registry of shared strings that already exist on both (extend as consolidated):

| Meaning | Web key | iOS key | Notes |
|---|---|---|---|
| "Add task" (button) | `tasks.addTask` | `tasks.add_task` | |
| New task | `tasks.newTask` | `tasks.new_task` | |
| Edit task | `tasks.editTask` | `tasks.edit_task` | |
| Delete task | `tasks.deleteTask` | `tasks.delete_task` | |
| Task name | `tasks.taskName` | `tasks.task_name` | |
| Description | `tasks.taskDescription` | `tasks.description` | **name mismatch** — reconcile |
| Add-task input placeholder | *(missing — hardcoded)* | `tasks.add_task_placeholder` | **Web gap** — Reuse Phase 2 adds `tasks.addTaskPlaceholder` mirroring this |
| My Tasks (nav) | `listHeaders.myTasks` | `navigation.my_tasks` | **group mismatch** — reconcile |

Known reconciliation items (surfaced by building this registry):
- **Web has no add-task placeholder key** — 6+ hardcoded English strings across 3
  components. Reuse Phase 2 introduces `tasks.addTaskPlaceholder` mirroring iOS's
  `tasks.add_task_placeholder`.
- **`description` / `taskDescription`** and **`myTasks` group** differ beyond
  casing — pick one canonical wording per row when the string is next touched.

---

## 3. Task detail layout (shared with iOS/Mac)

Task `dcbbb0fa` (Web) / `42013da7` (iOS/Mac). The row layout and the
full-screen affordance are **product decisions shared across all three
clients**, so they live here rather than being re-derived per platform.

**The goal is to see more of the description.** Stacked field rows are what
push it below the fold, so the row consolidation is where the space comes
from — that is the point, not tidier rows. Judge any future change to this
section by whether the description gained or lost room.

| Row | Contents | Rule |
|---|---|---|
| **When** | Date · Time · Repeat | Time and Repeat are **conditional on a date existing**. With no date the row is a single "Add date" control, not three empty ones. |
| **Priority** | Priority · Assignee | Priority leads — it is the row's label and its colour reads at a glance. A **public-list task shows its creator here instead**, and no priority. |
| Lists | list chips | unchanged |
| Description | — | receives the reclaimed space |

Further rules, learned on iOS and mirrored on Web:

- **Triggers size to their content**, not to the full row width, so three
  controls fit on one line.
- **Show only what is set.** An unset field is an affordance to add one, not a
  control showing "None".
- **No 80pt labels per field.** One label per consolidated row.

**Full-screen task details** is an escape hatch for a long description, not a
new default: off by default, and **never offered on the inline/board panel**,
which is deliberately a peek and would fight the board it is embedded in.

---

## 3. How this stays true (anti-drift)

- **Both repos cite this file.** Web: ASTRID.md → *Agent Working Agreements →
  Code Reuse & Consistency*. iOS: add the same one-line pointer to its agent
  guidance.
- **Permissions:** Web enforces "no inline owner/admin checks" via ESLint +
  `npm run check:reuse` (see the reuse doc). iOS should route through its
  equivalent permission helper, not inline role math.
- **Copy:** no hardcoded user-facing strings — use the i18n key / `NSLocalizedString`.
  A shared string added on one platform is a TODO to mirror on the other, logged
  here if the mapping isn't the obvious casing transform.

---

*Governs shared behavior, layout + copy. Wire formats: docs/context/api_contracts.md.
Reuse mechanics & rollout: docs/CODE_REUSE_AND_CONSISTENCY.md.*
