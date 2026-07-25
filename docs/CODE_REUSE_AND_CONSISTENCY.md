# Code Reuse & Cross-Platform Consistency

*Assessment + architecture proposal to stop duplication/drift within Web and
between Web and the Apple app (`astrid-ios`).*

Status: **PROPOSAL** (2026-07-25). Nothing here is wired in yet — see
[§5 Rollout](#5-rollout). Owner: TBD.

---

## 0. Why this exists

The trigger: the add-task box shows the long placeholder `Add task to Astrid Web
To-do…`. Chasing it surfaced that "add a task" has **6+ different placeholder
strings** and **3 separate input components** on Web, while iOS uses **one**
localized key. That's a symptom of a general pattern:

> **Good abstractions exist, but nothing enforces their use, so call sites (and
> AI agents) copy the nearest inline snippet instead of importing the helper.**

This document names the concrete duplication, proposes single sources of truth,
and — most importantly — sets up guardrails (lint + predeploy + agent
instructions) so the drift can't silently come back.

---

## 1. Findings (evidence)

### 1.1 Permission checks — a canonical API exists but is bypassed 54× in 16 files

`lib/list-permissions.ts` is a complete, well-typed permission API:
`getUserRoleInList`, `canUserViewList`, `canUserEditTasks`, `canUserEditTask`,
`canUserManageList`, `canUserManageMembers`, `canUserDeleteList`.

Yet **54 call sites across 16 files** hand-roll the check inline, e.g.:

```ts
// components/TaskManager/MainContent/MainContent.tsx:389
const isUserOwnerOrAdmin =
  selectedList?.ownerId === effectiveSession?.user?.id ||
  selectedList?.admins?.some(admin => admin.id === effectiveSession?.user?.id)
```

The exact `ownerId === user.id || admins.some(...)` shape is re-written in
`MainContent`, `TaskManagerView`, `TaskManagerHeader`, `TaskManager`,
`list-members-manager`, `list-membership`, `owner-leave-dialog`,
`task-detail/*`, `useTaskManagerController`, and more.

**Worse: the helpers themselves are duplicated.** There are two overlapping
permission modules:
- `lib/list-permissions.ts` → `canUserManageList(user, list)`
- `lib/task-manager-utils.ts:404` → `canEditListSettings(list, userId)`

A single component often uses *both a helper and an inline check for the same
question* — e.g. `MainContent` receives `canEditListSettingsMemo` (wraps
`task-manager-utils.canEditListSettings`) for the gear/title, but computes a
*separate* inline `isUserOwnerOrAdmin` for the add-task box. Two code paths, one
question, guaranteed to drift.

### 1.2 "Add a task" — 3 components, 6+ placeholders, 0 i18n

Three independent add-task inputs:
- `components/enhanced-task-creation.tsx` (desktop / 2- & 3-col)
- `components/mobile-quick-add.tsx` (mobile fixed footer)
- `components/quick-task-create.tsx`

Placeholder strings, all hardcoded English, none via i18n:

| String | Location |
|---|---|
| `Add task to ${listName}...` | enhanced-task-creation.tsx:104 |
| `Add task to current list...` | enhanced-task-creation.tsx:62 |
| `Add task...` | enhanced-task-creation.tsx:69 |
| `Add a new task...` | enhanced-task-creation.tsx:76 |
| `Quick add...` | enhanced-task-creation.tsx:76 |
| `Add a task` | mobile-quick-add.tsx:231 |

Meanwhile `lib/i18n/locales/en.json` has `"addTask": "Add task"` (a button
label), and the app fully supports i18n (`useTranslations`) — the input
placeholders just don't use it.

### 1.3 Settings popover mounted 4× in one file

`ListSettingsPopover` / `FixedListSettingsPopover` are rendered **4 times** in
`MainContent.tsx` alone (desktop-current, desktop-fixed, mobile-current,
mobile-fixed), each an almost-identical prop block. One `<ListSettingsHost>`
that takes `variant` would remove ~4 copies.

### 1.4 Cross-platform (Web ↔ iOS/macOS)

- iOS does the right thing: `NSLocalizedString("tasks.add_task_placeholder")`
  — **one** key (`QuickAddTaskView.swift`).
- The API surface has a contract (`docs/context/api_contracts.md`,
  `docs/API_CONTRACT.md`) — good.
- **But there is no shared source of truth for user-facing copy or for
  behavioral rules** (who can edit/manage a list, task defaults, empty-state
  wording). Each platform re-derives them, so Web says "Add task to …" and iOS
  says whatever `tasks.add_task_placeholder` resolves to. They can diverge
  silently because nothing links them.

---

## 2. Root cause

1. **No "reuse-first" gate.** Writing a fresh inline check is frictionless;
   finding the existing helper takes a grep nobody is required to run.
2. **Duplicate helpers** (`canEditListSettings` vs `canUserManageList`) mean even
   a diligent developer picks a different "canonical" one.
3. **Copy is inlined, not keyed.** Strings live at the point of use, so there's
   no registry to reuse from.
4. **AI agents amplify it.** An agent pattern-matches the surrounding code; if
   the surrounding code inlines the check, the agent inlines it too. (This
   session's 2-col fix did exactly that — it copied the inline `isUserOwnerOrAdmin`.)

---

## 3. Target architecture (single sources of truth)

| Concern | One home | Consumers do |
|---|---|---|
| List/task permissions | `lib/list-permissions.ts` (merge `task-manager-utils.canEditListSettings` into it, delete the dupe) | `canUserManageList(user, list)`, `canUserEditTasks(user, list)` — never inline `ownerId ===` / `admins.some` |
| Add-task input | one `components/task-input/AddTaskInput.tsx` with a `variant` (`inline` \| `footer`); the 3 current components become thin wrappers or are deleted | render `<AddTaskInput variant … />` |
| User-facing copy | i18n keys in `lib/i18n/locales/en.json` (base) | `t("tasks.addTaskPlaceholder")` — no string literals in JSX |
| Settings popover | one `ListSettingsHost` taking `variant` | mount once per layout |
| Cross-platform rules & copy | `docs/PRODUCT_CONTRACT.md` (new) — permission matrix, task defaults, and a **copy-key registry** mapping Web key ↔ iOS `Localizable.strings` key | both repos cite the contract; PRs touching shared behavior update it |

Principle: **behavioral rules and user-facing copy are data with one owner, not
code re-derived per call site or per platform.**

---

## 4. Anti-drift guardrails (the important part)

Consolidation without enforcement re-rots. Add all four:

1. **ESLint `no-restricted-syntax`** (fails CI):
   - Ban `.admins?.some(` and `ownerId ===` outside `lib/list-permissions.ts`.
   - Ban string literals matching `/add (a )?task/i` in JSX (force i18n).
2. **predeploy check** `check:reuse` (mirrors `check:model-sync`): greps for the
   banned patterns and for newly-added duplicate helper names; exits non-zero
   with the offending file:line and the helper to use instead.
3. **Reuse-first step in the coding workflow** (ASTRID.md → Coding Workflow):
   before writing a permission check, a user-facing string, or an input
   component, `grep lib/ components/` for an existing one; cite it in the
   strategy comment or justify the new one.
4. **Agent instruction** (CLAUDE.md + ASTRID.md + AGENTS.md, one shared line):
   > Reuse before you write. Permission logic lives only in
   > `lib/list-permissions.ts`; user-facing copy lives only in i18n locale
   > files. Never inline an owner/admin check or a hardcoded task string — import
   > the helper / use the key. If no helper/key fits, add it there, don't inline.

The lint rule + predeploy check are what actually stop drift; the doc and
instruction lines tell humans and agents *why* and *where*.

---

## 5. Rollout

Phased so each step is independently shippable and guarded before the next:

- **Phase 0 — guardrails first.** Land this doc, the ESLint rules, and
  `check:reuse` in **warn** mode (report, don't fail). This quantifies the
  backlog without blocking.
- **Phase 1 — permissions.** Merge `canEditListSettings` into
  `list-permissions.ts`; replace the 54 inline checks; flip the permission lint
  rule to **error**. (Highest count, highest correctness risk — do first.)
  *Pilot:* fix the `MainContent` add-task `isUserOwnerOrAdmin` from this session
  as the first conversion.
- **Phase 2 — add-task + i18n.** One `AddTaskInput`; one
  `tasks.addTaskPlaceholder` key; flip the string-literal lint rule to error.
- **Phase 3 — popover host + cross-platform contract.** `ListSettingsHost`;
  create `docs/PRODUCT_CONTRACT.md` with the permission matrix and copy-key
  registry; add the same reuse line to `astrid-ios` guidance.

Each phase: RED regression test for any behavior touched (per ASTRID.md TDD),
`npm run predeploy`, preview, ship.

---

## 6. Open questions for the owner

1. Merge direction for permissions: fold `task-manager-utils.canEditListSettings`
   into `list-permissions.ts`, or the reverse? (Proposed: into `list-permissions`.)
2. Is one `AddTaskInput` with variants acceptable, or do the three inputs have
   real divergent behavior that justifies staying separate? (Needs a 10-min diff.)
3. For cross-platform copy: lightweight (a documented key registry both repos
   hand-mirror) vs. heavyweight (a generated shared strings file)? Proposed:
   start with the registry.
