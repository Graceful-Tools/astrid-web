# Product Contract — shared behavior & copy across Web, iOS/Mac and Windows

*Single source of truth for the rules and user-facing strings that **every**
client must honor, so the platforms don't drift: the web app (this repo), the
Apple app ([astrid-ios](https://github.com/Graceful-Tools/astrid-ios), which
ships both iOS and Mac), and the Windows app
([astrid-windows](https://github.com/Graceful-Tools/astrid-windows)).*

> Several of these rules are enforced as **generated fixtures** rather than
> prose: `contracts/fixtures/*.json` in this repo are produced by running this
> repo's own implementations (`npm run export:contract-fixtures`), and
> astrid-core's tests replay them; iOS/Mac, Windows and Android run those rules
> through the core they pin. A behaviour change here therefore lands as a
> coordinated change — web first with tests, then the fixtures, then the core,
> then the clients' pins (ASTRID.md → *Cross-platform contracts*). Divergences
> that cannot be closed in one change are written down in astrid-core's
> [divergence register](https://github.com/Graceful-Tools/astrid-core/blob/main/docs/CONTRACTS.md).

Status: **active**. Companion to
[docs/CODE_REUSE_AND_CONSISTENCY.md](./CODE_REUSE_AND_CONSISTENCY.md).
API shapes live in [docs/API_CONTRACT.md](./API_CONTRACT.md);
this file governs *behavioral rules* and *copy*, not wire formats.
How the shared components **look** (colours, sizes, motion, themes) is
[docs/specs/DESIGN_SYSTEM.md](./specs/DESIGN_SYSTEM.md).

> Rule of thumb: if a change alters **who can do what** or **what words the user
> sees**, and it should look the same everywhere, update this file in the
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
   admin — project membership can never *demote* someone. And the other way
   (Jon, 2026-10-04): a plain list member who owns or administers the project
   is an **admin** of the list — a plain list membership can never demote a
   project owner or admin either. Before that date list membership was
   consulted first and such a person was only a member.
2. **The project owner resolves to `admin`, not `owner`.** `owner` is the only
   role that can delete a list; owning the project must not grant the power to
   delete a list somebody else owns and merely attached to it.
3. **A project member is never downgraded to `viewer` on a PUBLIC list.** They
   are a real collaborator, not a passer-by.

**Moving a list (AWTD-1702).** Because membership cascades, moving a list is stricter than
reading it. Table (the core's `listProjectMoves` fixture is the same):

| Action | Needs on the list | Needs on the project |
|---|---|---|
| Create a new list in a project | n/a (the creator owns it) | owner, admin or member |
| Attach (`projectId: <id>`) | owner or admin | owner or admin of the destination |
| Detach (`projectId: null`) | owner or admin | owner or admin of the project it leaves |
| Move between projects | owner or admin | owner or admin of **both** |

A plain project member can no longer attach or detach (before 2026-11-15 any member could
attach). Tasks move with the list; a task whose custom `statusRole` the destination lacks
shows in Inbox there and keeps its stored role, so moving back restores it.

**Renaming a project (ADEV-48).** `PATCH /api/v1/projects/:id { name }` (scope `projects:write`)
sets the display name, trimmed and non-empty (`400 PROJECT_NAME_REQUIRED`), with no length limit,
the same as create. Who may: the project's **owner or an admin**, the same bar as moving a list
in or out. Decided 2026-11-16 (agent): Jon asked for "admin", and `authorizeBoardOwner` alone
would have refused admins. A plain member or non-member gets `403 PROJECT_RENAME_FORBIDDEN`.
`{ key }` stays owner-only (AWTD-1024), and `{ name, key }` together need the owner; if the key
is refused nothing changes. Members' list caches are invalidated. Online only; old clients never
send `name`, so the halves ship independently.

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

## 2. Shared user-facing strings come from astrid-core

The hand-kept copy-key registry that lived here is retired (AWTD-1649). The strings web and iOS
share are now **astrid-core's shared catalog**, the strings/shared directory in astrid-core: one key in the
core's dotted snake_case, twelve languages, checked by `cargo xtask check-strings`.

| | Where |
|---|---|
| The catalog | astrid-core, strings/shared (and strings/ for the strings the core itself emits) |
| Web's copy, pinned | `lib/i18n/core-strings/` — `REVISION`, core's generated `web/<locale>.json`, and `sources.json`, the map from each shared key to the web keys with the same English |
| Web's lookup | unchanged: web keeps its own camelCase key names, and `scripts/sync-core-strings.mjs` writes core's value into each mapped key |
| The ratchet | `tests/i18n/core-shared-strings-awtd-1649.test.ts`: a mapped web value must equal core's, unless the pair is on `lib/i18n/core-strings/divergent.json` |

**Adding or changing a shared string:** change it in astrid-core's catalog, then move the pin
with `node scripts/sync-core-strings.mjs --rev <core sha>`. A hand edit to a mapped key in
`lib/i18n/locales/` fails the ratchet.

**The divergence list** holds the pairs (locale, web key) where web's wording and core's differ,
or where two shared keys claim one web key with different translations (core has `add` and
`actions.add`, both "Add" in English, "Añadir" and "Agregar" in Spanish). Each keeps web's
wording until someone decides which translation wins; settle it in core, re-sync, and run
`--update-divergent` so the list shrinks. It may never grow.

**Web-only strings rendered on the server** are not shared and are not in the core catalog. iOS
shows them as sent:

| What | Web key | Notes |
|---|---|---|
| Astrid: "set up a model" chat reply | `astridAgent.modelSetup.noModel` | Posted as Astrid's chat message in the request's `Accept-Language` (AWTD-1054). The link stays root-relative `/settings/agents`, which iOS routes in-app (AITD-451) |
| Astrid: "your model only runs on Apple devices" | `astridAgent.modelSetup.onDeviceUnavailable` | As above; sent when an on-device model is selected but the client cannot run it |
| Push notifications, the service worker's toasts, reminder / daily / weekly emails | `notifications.{actions,push,worker,dates,email}.*` | Rendered in the recipient's `User.locale` (AWTD-1592), English when unknown. A native client sends its device language as `locale` on `PUT /api/v1/users/me/settings` (`zh-Hans`/`zh-Hant` map to `zh-CN`/`zh-TW`). Each push carries the worker's labels in `data.labels` (`lib/i18n/worker-labels.ts`) |

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
| Reminder | the task's own reminder time | **Web: hidden unless opted in.** Appearance → "Task reminders" turns the row on; it is off by default and kept per device, like the theme (AWTD-1577; `lib/design/task-reminders.ts`). The setting is the whole rule — a task that already has a reminder does not bring the row back — and it hides the row only: the reminder stays on the task and still fires. |
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

**The details panel follows its card across columns** (ADEV-177, from iOS ADEV-175). When the
open task's card changes column — completed into Done, marked to-do, a status set from the
details — the board scrolls so the new column is in view on the side the card was opened on,
clear of the panel; the column scrolls to the card; and the panel re-docks beside it, its
arrow pointing at the moved card (the side decided again by core `calloutPlacement`). A
different task opening is not a move. Windows and Android follow this too. Design spec: *Task
details panel* (DS7).

**A completed task opens with its history showing** (ADEV-129). The comment thread shows system
comments by default when the task is completed, because "marked this as complete" is its
completion history. An open task keeps them hidden until asked.

---

## 4. The task leading control (shared with iOS/Mac)

Task `2bb1b196` (Web) / `42013da7` (iOS/Mac). What the control at the start of a
task shows is a **cross-platform promise**, not a per-client detail.

It answers one question — *whose task is this?* — and that question has **three**
answers, not two:

| State | Mark |
|---|---|
| Assigned to **someone else** | their photo, in a priority-coloured square |
| Assigned to **you** | the completion checkbox |
| Assigned to **nobody** | the unassigned mark, in a priority-coloured square |

Unassigned used to be folded in with "mine", so a task nobody owns rendered
identically to a task you own. That is the bug this rule exists to prevent.

- **The mark changes; so may the action.** On web, someone else's photo opens
  the task options sheet rather than completing (AWTD-877). On a list row the
  unassigned mark does too (AWTD-919), and so does your own checkbox when the
  list is on a board, where the mark stays the checkbox (task 036ef139). On a
  board card your own checkbox completes in one tap and an unassigned card's
  mark asks first (below). Everywhere else your own checkbox completes in one tap.
- **Completing a task that is not yours asks first** (ADEV-56, widening
  AWTD-877). Someone else's task *and an unassigned one* show "Complete this
  task?" naming the assignee, or saying nobody holds it, before completing.
  In the options sheet the question is the sheet itself: a muted line saying
  whose the task is ("Assigned to …" / "Not assigned to anyone") above Cancel
  and Complete (ADEV-158).
  Your own task never asks, and reopening never asks. Web:
  `completionNeedsConfirmation` in `lib/task-leading-control.ts`, asked by the
  options sheet, the leading control and the complete-task shortcut — and, since
  ADEV-71, by a subtask's checkbox (by the *subtask's* assignee), a reminder's
  Complete, choosing Done in a status picker, and dragging a card onto Done
  (nothing moves until the answer, so a cancelled drag leaves the card where it
  was). Moving into any other column never asks. The decision reads
  `assigneeId`, never the loaded `assignee`. A push notification's Complete
  cannot show a dialog, so it completes only when the sender marked the task
  as the recipient's own (`completesWithoutAsking`) and otherwise opens the
  task.
- **Web has no "Project" task layout** (ADEV-56). The `taskDisplayMode`
  setting is still stored and served for iOS/Mac, where `project` remains a
  valid value; web always renders the list layout and no longer offers the
  choice in Appearance.
- **The picker shows the mark you will then see.** The assignee picker's
  unassigned option uses the same mark.
- **It applies everywhere the control appears** — task row, task details,
  quick add, and board cards.
- **Decide once, render once.** Web: `lib/task-leading-control.ts` decides,
  `components/task-leading-control.tsx` renders. iOS:
  `TaskLeadingControl.kind(assigneeId:currentUserId:)`. No component decides
  for itself — that is how the row and the detail drifted apart.
- **A completed task always shows the checked checkbox, whoever holds it**
  (ADEV-147; earlier only completed + unassigned did). The mark has to be able
  to read as checked, and neither the unassigned mark nor someone else's photo
  can. Only the mark changes: a tap on someone else's task still opens the
  picker rather than reopening it. The rule lives in astrid-core
  (`LeadingControl::for_row`) and `contracts/fixtures/leading-control.json`
  keeps web and core answering the same table.

Shared copy for the mark:

| Meaning | Web key | iOS key | Notes |
|---|---|---|---|
| Unassigned mark (single glyph) | `tasks.unassignedMark` | `tasks.unassigned_mark` | Localised per language (en `U`, ja `未`, ru `Н`) — it is the first letter of that language's word for "unassigned", not a literal `U`. **iOS gap:** iOS currently hardcodes `U`. |

---

## 5. Pickers name the outcome, not the mechanic

Task `ab01186a` (Web) / `42013da7` (iOS/Mac). Shared user-facing strings, so
they are keys on both platforms rather than literals in a component.

A picker's ESCAPE from a value must be labelled by **the state the user is
choosing**, not by what happens to the field:

| Picker | Was | Is | Why |
|---|---|---|---|
| Date | "Clear" | **No date** | "Clear" describes the field; the user is choosing that the task has no date. |
| Time | "Clear" | **All day** | A task with no time is not a task with a missing field — it is an *all-day* task, a real nameable state. |
| Repeat | "Never" | **One time only** | "How often?" answered with a negative. The state is that this happens once. |

`No date`, `All day` and `One time only` are states a user can intend and
recognise; `Clear` and `Never` are things you do to a form.

**The picker and the summary must use the same words.** The task row and the
detail summary say these states back to the reader, so the picker agrees with
the rest of the UI instead of keeping its own vocabulary. (The detail summary
said "No time" where the picker now offers "All day" — same state, two names.)

**This is a copy change, not a data change.** The stored repeat value is still
`"never"`; only what the reader sees changed.

**Not in scope:** the custom-repeat editor's *end condition* "Never". That
answers a different question — "when does this repeat end?" — and there
"never" IS the outcome.

| Meaning | Web key | iOS key |
|---|---|---|
| No date | `time.noDate` | `picker.no_due_date` |
| All day | `time.allDay` | `picker.all_day` |
| One time only | `repeating.oneTimeOnly` | `repeating.one_time_only` |

**Group mismatch:** Web keeps the date/time states under `time.*` where iOS
uses `picker.*`; the repeat group matches. Reconcile when next touched.

---

## 6. One editing session at a time

Task `7b60c7c5` (Web) / `55010e29` (iOS/Mac). "What happens to my edit when I
click elsewhere" is a cross-platform promise, not a per-client detail.

**Exactly one editor is open at a time**, and the rule is stated once rather
than re-derived per editor:

| Transition | Effect |
|---|---|
| `begin(B)` | **commits** and closes whatever was active, then activates B |
| `end(A)` | commits A |
| `cancel(A)` | reverts A — **the only transition that discards** |

**UNIVERSAL POLICY: commit on resign.** Tapping outside, opening another
editor, navigating away and backgrounding all **save**. Only an explicit Cancel
reverts. One rule to learn, one rule to test.

Why it must be a machine and not a convention: the failure mode is a dozen-plus
editors each with its own `isEditing` flag, where mutual exclusion depends on
every call site remembering to close the others. `begin` closing the previous
editor **by construction** is what makes the guarantee real. Web's task detail
alone had eight independent booleans with nothing stopping two being true.

Two details that only show up once it is wired to real views:

- **Stale `end` must be ignored.** A blur routinely arrives *after* `begin`
  handed off; honouring it writes the old editor's value over the new one's.
- **Editors that commit on selection register no commit handler.** Date, time,
  priority and repeat save when you pick — for them, closing is the whole
  story. Only editors holding a pending buffer (title, description, lists,
  assignee) need a hand-off commit.

Web: `lib/editing-session.ts` (pure) + `hooks/use-editing-session.ts` (binding).
iOS: the `EditingSession` coordinator behind one `.editingSession(id:onCommit:onCancel:)`
view modifier.

**The session is app-wide.** `EditingSessionProvider` is mounted in
`components/providers.tsx`; editors reach it through `useSharedEditingSession`.
This matters more than it looks: `useEditingSession` is a plain hook, so every
caller gets its OWN machine — migrating a second area by calling it again would
have produced two independent sessions and let a list editor and a task-detail
editor both be open. Components outside a provider fall back to a private
session, which keeps the task detail's ~40 existing call sites and their tests
working unwrapped.

**Web migration status: complete for content editors.** On the session: the
task detail's eight, the list-name and agent-instructions editors, the
list-admin and list-detail default-value pickers, the status-rename editor, the
comment editor and the passkey-rename editor.

Deliberately NOT on the session — they are not content editors with save
semantics, so "commit on resign" has nothing to commit: the sort/filter pickers
in `list-sort-and-filters.tsx` and the OAuth client modal in
`oauth-app-manager.tsx`. Revisit only if one of them grows a pending buffer.

Audit each editor for a visible Cancel as it migrates. `ListNameSection` had
Escape/X that closed without reverting the draft, so "cancel" silently kept the
abandoned text and it reappeared on the next open — migrating it onto
`cancelEditing` is what fixed that. Note that on web only four components saved
on blur to begin with, so commit-on-resign was a real behaviour change here,
not a tidy-up.

---

## 8. Decision cards and trade-off grids (comments)

Two markdown shapes that comments draw richly on every platform. Anything else is plain markdown.
Reference recogniser: astrid-ios `Packages/AstridCore/Sources/AstridCore/Decision.swift`; web:
`lib/comment-formats.ts`. How to write them, with the canonical example: [DECISIONS.md](./DECISIONS.md).
Web is held to `contracts/fixtures/decisions.json`; AstridCore has its own tests (DecisionTests,
AITD-585) and does not read the fixture yet.

**Code is code.** A Decision on lines markdown draws as code (inside a ``` or ~~~ fence, or
indented four spaces) is an example and stays code.

**Decision.** A paragraph starting with bold `**Decision:**`, followed directly by a list whose
every item starts with a bold marker — a number of up to two digits or a single letter (`1.` /
`1)` / `1:` / `1`, or `A.` …) — at least two items. Options are numbered 1, 2, 3 in list order
whatever marker was written (AWTD-1533, iOS AITD-585); each draws as a card with its number, and a
trailing `(recommended)` becomes a badge. Clicking a card posts `<number> — <option text>` as an
ordinary comment (that reply wakes the agent via `AGENT-HANDBACK`). Cards are inert in a
description, on your own question, and once someone other than the asker has replied after it
(system comments don't count). If that reply leads with an option's number, or with the marker the
asker wrote (letters case-insensitive), followed by end/space/punctuation, that card shows as
chosen. `2nd thoughts` and `10 minutes` (no tenth option) choose nothing.

**A grid that is the choice** (iOS/Mac ADEV-229, web ADEV-230). When a trade-off grid follows the
options, before the next Decision, with exactly as many body rows as options, the decision draws as
the question and the grid only, with no cards; row n is option n. While open, a hint above the grid
("Tap an option to choose it.") and every cell of a row choose that row, through a confirmation
("Post your choice?", confirm "Choose 2 — Cabin") that posts the same `<number> — <option text>`
reply. Once answered, the chosen row is ringed with a ✓ and the others dimmed; `(recommended)`
badges its row ★. Inert in the same cases as cards. Any other grid, or none, keeps the cards and
draws the grid after them. The markdown is unchanged: writers keep both the list and the grid.
Strings: `decision.tap_row_hint`, `decision.confirm_title`, `decision.choose_option` (web
`tasks.decision.tapRowHint`, `confirmTitle`, `chooseOption`).

**Trade-off grid.** A GFM table where every non-empty body cell after the first column starts
with a rating token followed by whitespace or end: `--` disqualifying, `-` poor, `~` mixed or unknown, `+` good,
`++` decisive, or 🔴 poor / 🟡 mixed / 🟢 good (the two bright ones mean one cell alone rules the
option out or is reason to choose it; ADEV-178, [DECISIONS.md](./DECISIONS.md) → The method). Not a grid if any such cell lacks a token, or if
every rated cell is a bare `-`. Each cell draws on its colour with the remaining words
(five fills from red to green, white text on the two dark ones and near-black on the three light:
the design tokens' `palette.tradeoff` and `palette.tradeoff-text`, Google Docs' palette; see
[specs/DESIGN_SYSTEM.md](./specs/DESIGN_SYSTEM.md) → Markdown). A cell with no reason shows its token. Each cell tells
assistive technology its rating in words ("Good. fast"), and the colour key under the grid names the
ratings used in words (Disqualifying … Decisive, localised), worst to best. Rows are numbered 1, 2, 3
and lose the marker their writer put in front (`A. Lisbon`, `2) Cabin`, a lone `B`); criteria
columns are lettered A, B, C (AA after Z) before their names. Every option row is as tall as
the tallest, and the criteria columns share the width equally, at least 84 (pt or px) each. A
column grows past its share only to fit its longest word, so no text is clipped or broken mid-word.
The option column is as wide as its longest name, from 6 to 12rem (about 96–192) and at most a
third of the screen's width, and wraps past that (AWTD-1536). Rated cells centre both ways, column and option names vertically. A grid wider than its
container scrolls sideways, and a sideways drag there scrolls the grid rather than dismissing the
task or pane behind it. Every grid offers a full-screen view of itself (web: "Full screen", AWTD-1534).

---

## 9. The project board (Project Mode, AWTD-1660)

Shown only to someone with Project Mode: the deployment ships it (`CAPABILITIES.projectMode`) and
the person has the `project_mode` flag (`GET /api/v1/features`), from an admin grant or the
`PROJECT_MODE_ALLOWLIST_EMAILS` list. Web is first; Mac and Windows follow this section.

- **Sidebar.** A *Projects* section lists the projects the person owns or belongs to. A project
  opens its board; its chevron expands it to show its lists.
- **Board.** Each chosen list is a row; the project's status columns (Inbox, Ready, Doing,
  Waiting, the project's custom columns, Done) are the columns. A card's column is its
  `statusRole`, exactly as on a list's own board, and moving a card sets it the same way. A card
  on two row lists shows in both rows. Done is bounded by the board's Done period alone, not the list's
  recently-completed window (ADEV-191): the Done header reads "15 ✓ This week" and opens Today / This week /
  This month / This year / Pick a date… / All time. The period filters the cards as well as the
  count, the week is Monday to Sunday, and the default is This week, kept per person and per
  project on the device (ADEV-133). Done is newest-completed first whatever the sort, and each Done
  card shows "✓ on Nov 19" (the year only when it is not this year). The Sort & Filters the person
  has set (priority, assignee, due date, sort) apply to every row (ADEV-145).
- **Rows.** Drag a list from the sidebar onto the board, or use *Add list*, to add it; × on the
  row header removes it. The choice is the person's, per project, saved on the server
  (`GET|PUT /api/v1/projects/{id}/board-rows`, see API_CONTRACT.md) so every device shows the
  same rows. Nothing saved means the project's own lists; an emptied board stays empty.
- **Goals & guardrails** (ADEV-179). The board header shows a toggle with the project's goal and
  guardrail counts that opens the full statement: goals in order with their measure, `Target: …`
  and `Now: …`, and guardrails with `enforced` marked. It draws nothing when the project states
  none. The owner or an admin edits them in Project settings (the board's gear); agents read them
  and never write them. Wire: API_CONTRACT.md `/api/v1/projects/{id}/goals`.

---

## 7. How this stays true (anti-drift)

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

*Governs shared behavior, layout + copy. Wire formats: docs/API_CONTRACT.md.
Reuse mechanics: docs/CODE_REUSE_AND_CONSISTENCY.md.*
