# Astrid vs Linear — re-review

**Re-drawn 2026-08-19.** Supersedes the 2026-07-31 comparison that drove the
Tier 0 / Tier 1 backlog. Every row below was verified against `main` on the date
above; where the earlier map and the code disagree, the code won.

The headline is not "most of Tier 1 shipped". It is that **three of the shipped
items cannot be reached by a user**, and a roadmap that counts them as done is
counting wrong.

---

## 1. What actually shipped, verified

| Gap | Shipped as | Verified state | Reachable by a person? |
| --- | --- | --- | --- |
| G1 shared board statuses | `Task.statusRole` (+ `TaskList.statusRole`), both indexed | Live | **Yes** |
| G2 project membership | `getUserRoleInList` + `listVisibilityWhere` (`lib/list-permissions.ts`), ~8 call sites | Live | **Yes** |
| G3 canceled state | `Task.closedReason`, indexed, wired through `TaskActionMenu` | Live | **Yes** |
| G4 identifiers | `Project.key` + `Task.identifier`, unique-indexed, rendered in task rows and detail | Live | **Yes** |
| G5 labels | `listType: 'label'` (`LIST_TYPE_LABEL`, `lib/list-flavors.ts`); `label:` supported by `lib/search-query-parser.ts` | Half-closed — **no picker UI in any component** | **No — you cannot apply one** |
| G6 command palette | `lib/command-palette.ts` | **Model only.** Zero `.tsx` importers, nothing bound to ⌘K | **No** |
| G7 activity history | `TaskEvent` + `recordTaskEvents` | Live, and genuinely writing — called from **both** `app/api/v1/tasks/[id]` and `app/api/tasks/[id]` | **Yes** |
| G8 notification inbox | `Notification` + `fanOutEvent` (`lib/notifications.ts`) | **Inert at both ends** — see below | **No** |
| G9 server-side search | `GET /api/v1/search` | Live, `contains`-based; **no client calls it** | **No** |

Also shipped outside the original list: request-gated Project Mode with demand
counts, completion-streak folding, the task-detail redesign, and the "Task
Details" header removal.

### G8 is worse than previously recorded

The earlier note said "nothing calls `fanOutEvent`". Verified on 2026-08-19, it
is inert on **both** sides:

- **No producer.** `fanOutEvent` has exactly one occurrence in the repo — its own
  `export function` in `lib/notifications.ts`. Nothing invokes it.
- **No consumer.** `app/api/v1/notifications/route.ts` exists, and no client
  component or hook calls it.

So the feature could not surface a notification even if something produced one.
Finishing it is two pieces of work, not one, and either alone still shows a user
nothing.

### G9's `contains` is a deliberate choice, not an oversight

`app/api/v1/search/route.ts` says so in a comment: a tsvector column is a
migration, and the simple form was chosen first. That decision should stand
until there is a client generating real query load — indexing an endpoint
nobody calls optimises a number no user experiences.

### The stale-docs item was already handled

The task listed `docs/product/project-status-board.md` as stale for still
describing status as list membership. It is not: the doc opens with a dated
callout — *"Status stopped being a list membership on 2026-08-02 (AWTD-562)…
Everything below describing status as 'special list membership' is historical"* —
and states the field model up front. No change needed. Recorded here because
"verify before rewriting" is the cheaper half of this exercise.

---

## 2. Half-closed is worth less than open

Three gaps (G5, G6, G8, and G9 for the client half) read as *done* on a roadmap
and deliver nothing. That is strictly worse than an open gap, for two reasons:

1. **It hides the work.** An open row gets re-estimated each planning pass. A
   row marked shipped never comes back.
2. **It costs maintenance now, value later.** `fanOutEvent`, the palette model
   and the search route all carry tests and have to keep compiling, while
   returning nothing.

**Recommendation: each of these is either finished or explicitly parked.** They
should not stay in the current state, which is neither. Follow-up tasks filed
for the four (see §5).

---

## 3. What Astrid has that Linear does not

- **`statusRole` as a task field, not a board column.** Linear's status is
  per-team workflow state; Astrid's is an indexed field on the task, so
  "everything Ready across every project" is one cheap query. Linear does not
  really offer that view.
- **`TaskEvent` as an audit trail**, written on both API surfaces. Linear has
  history; GitHub Projects does not.
- **Per-project custom states as config** (`Project.customStates`, JSON). A
  "workflow" feature is much closer than the original Tier-2 estimate assumed —
  the storage and the board rendering already exist.
- **Cross-platform contract with a native client.** Astrid's iOS app consumes
  the same API, and `docs/PRODUCT_CONTRACT.md` pins the shared behaviour.

## 4. What Astrid still lacks

Ranked by the gap between what exists and what a user can do:

| Missing | Distance from shipped |
| --- | --- |
| Applying a label | **Small** — model + search filter exist; needs a picker |
| Command palette | **Small–medium** — model exists; needs a dialog + binding |
| Notifications a user sees | **Medium** — needs producer *and* consumer |
| Search from the UI | **Small** — endpoint exists; needs a caller |
| Estimates, relations, cycles | Not started |
| Timeline / insights | Not started |
| Shared saved views | **Possibly unnecessary** — see §5 |

---

## 5. Re-ranked next tier

The original Tier 2/3 list (project objects, estimates, relations, cycles,
shared views, timeline, insights) was written before any of the above existed.
Re-ranked:

1. **Finish the four inert items.** Highest value per unit of work in the whole
   backlog, because the expensive half is already built and paid for. Order:
   label picker → command palette dialog → search client → notification fan-out
   plus inbox surface. Filed as separate tasks.
2. **Workflow / custom states polish.** Now cheap, since `Project.customStates`
   is config and the board renders it.
3. **Estimates and relations.** Genuinely not started; ordinary cost.
4. **Shared saved views — reconsider before building.** `statusRole` plus the
   search endpoint may already cover the real use ("Ready across projects",
   "everything assigned to me"). Build the search client first and see what
   people actually ask for; a saved-view system built now would be guessing.
5. **Full-text indexing — defer.** Explicitly, until the search client produces
   query volume worth indexing.

---

## 6. What we got wrong twice, and where else it could bite

Status scoping shipped a duplication bug in May, again on 2026-08-01, and was
only structurally fixed on 2026-08-02 by moving status from *list membership* to
*a field on the task*.

The shape of that mistake: **an attribute of a task stored as a membership.**
Membership is a set, so nothing stops two of them, and every read has to pick a
winner. The fix was not a better guard — it was making the illegal state
unrepresentable.

Where else the same shape appears, worth auditing before it bites a third time:

- **Labels (`listType: 'label'`).** A label *is* modelled as list membership.
  That is defensible — a task genuinely has many labels, so a set is the right
  structure — but it means label reads share the "which memberships are really
  memberships?" problem that `lib/list-flavors.ts` exists to answer. The
  canonical filter helper is there for this reason; inline `listType !== 'label'`
  checks are the thing to watch for.
- **Board membership vs. status.** Now separated, and `scripts/set-task-status.ts`
  encodes the distinction (status is a second membership alongside the board, and
  a `PUT` replaces the whole `listIds` set). That footgun is documented rather
  than removed — a task moved with the wrong helper still lands off every board.

---

## Sources

Verified against `main` on 2026-08-19: `prisma/schema.prisma`,
`lib/list-permissions.ts`, `lib/list-flavors.ts`, `lib/command-palette.ts`,
`lib/notifications.ts`, `lib/task-events.ts`, `lib/search-query-parser.ts`,
`app/api/v1/search/route.ts`, `app/api/v1/notifications/route.ts`,
`app/api/v1/tasks/[id]/route.ts`, `app/api/tasks/[id]/route.ts`,
`components/task-detail/TaskActionMenu.tsx`, `docs/product/project-status-board.md`.

Related: [PROJECT_MODE.md](./PROJECT_MODE.md) ·
[project-status-board.md](./project-status-board.md) ·
[../PRODUCT_CONTRACT.md](../PRODUCT_CONTRACT.md)
