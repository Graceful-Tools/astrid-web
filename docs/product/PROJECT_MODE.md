# Project Mode

*Spec of record for the project/team-first side of Astrid. Task `e627f967`.*

Status: **v1** (2026-07-31). Companion to
[project-status-board.md](./project-status-board.md), which specifies board
*behavior*; this file governs **scope, gating and the rules every Project Mode
change must satisfy**.

---

## The goal

Enough of Linear's capability surface that a product team can plan and run on
Astrid, with **none** of the ontology tax that would cost us consumer-grade
simplicity.

## The bet

Astrid's one great idea is that **a `TaskList` does the job of five nouns**:
folder, label, status column, permission boundary, saved filter, chat channel,
MCP scope, agent instruction file. Linear needs eight entities to say the same
thing.

Every Project Mode change must be expressed *through that primitive*, or as a
**nullable field that draws zero pixels until someone uses it**.

> If a change makes a solo user's first-run experience one step more
> complicated, it is wrong — no matter how much a team would like it.

## Progressive disclosure — the rule

Every capability passes one test: **does an existing single-player user see
anything new before they opt in?** Three mechanisms, in preference order:

1. **New concepts become list *flavors*, not new nouns.** `listType` already
   carries `regular | status`. Labels become `listType: "label"`. A cycle
   becomes a virtual list with a date window. Users learn one primitive.
2. **Disclosure triggers on shared-board state.** A list with a `projectId`
   **and** more than one member is a *team board*. That is the signal that
   surfaces identifiers, activity history, shared statuses and the notification
   inbox. A private list never grows a new affordance.
3. **Nullable columns render nothing.** `closedReason`, `identifier`,
   `estimate`, `blockedByTaskId` all default to null and draw no UI.

The existing "Create Board" action is the model: a plain list *becomes* a board
on demand. Extend that pattern; do not add a settings page of toggles.

---

## Gating: three layers, checked in this order

Implemented in **`lib/project-mode.ts`**. Never inline these checks at a call
site — that is exactly how the inline-permission drift in
[CODE_REUSE_AND_CONSISTENCY.md](../CODE_REUSE_AND_CONSISTENCY.md) started.

### 1. `CAPABILITIES.projectMode` — build-time, per deployment, absolute

Declared in `lib/brand/capabilities.ts`, defaults **enabled** so existing
deployments are unchanged. A brand that disables it does not have Project Mode
at all, and **no runtime flag can turn it back on** — `canUseProjectMode`
returns false without ever consulting the flag service.

Disabling a capability must **refuse the request server-side**, not merely hide
a button. Hiding UI while leaving the endpoint reachable is not a configuration
option, it is an unenforced access-control boundary.

### 2. The `project_mode` runtime flag — per user, admin-controlled

A key in `FEATURE_KEYS` (`lib/feature-flags.ts`), seeded `enabled: true` with
`rolloutMode: SELECTED_USERS` — i.e. **off for everyone until an admin includes
someone**.

> Seeded `SELECTED_USERS` rather than `OFF` deliberately: `OFF` is absolute and
> ignores INCLUDE targets, so an admin granting a request would appear to
> succeed while the user still had no access.

### 3. Shared-board disclosure — per list, decides what renders

See the progressive-disclosure rule above. This layer never grants access; it
only decides which affordances appear for someone who already has it.

### HTTP semantics

| Situation | Status | Why |
|---|---|---|
| Capability off | **404** | The feature does not exist in this deployment; it should look absent, not forbidden. Matches `capabilityGate`. |
| Capability on, flag off | **403** + `reason: "not_granted"` | The feature exists, this user hasn't been given it. A 404 here would be a lie, and the client needs the distinction to render the request affordance. |

Enforced on `/api/projects/from-list`, `POST /api/v1/projects`, and any future
project-creating route. **An OAuth client must not be a way around the opt-in.**

---

## Access requests (task `dd7172d8`)

Project Mode is **request-only**. The point is measuring demand, not billing —
there is no payments logic and no payments copy anywhere in this feature.

- `FeatureAccessRequest`, unique on `(userId, featureKey)`. One person asking
  twice is one data point; re-requesting updates the note.
- `POST /api/v1/feature-requests` records the request and emails
  `FEATURE_REQUEST_EMAIL` (default `jon@gracefultools.com`, env-overridable so
  whitelabel partners route their own).
- `GET /api/admin/feature-requests` returns the queue **plus demand counts**;
  rendered at `/admin/feature-requests`.
- **Granting is the opt-in**: it marks the request GRANTED *and* adds the user
  as an INCLUDE target, in one transaction, so the queue and the flag can never
  disagree.
- **Grandfathering.** Users who already had a board when the gate landed keep
  it, flagged `grandfathered: true` and **excluded from the demand count** —
  they never asked for anything, and counting them would overstate the signal
  on day one, which is the exact question this feature exists to answer.

### Boards and Projects are the same product

A "board" is just a list with `projectId` set, and "Create Board" calls
`/api/projects/from-list`. Gating Projects therefore gates Boards for free.
The one real cost is that **existing board owners must not lose their boards** —
hence grandfathering, and hence `BoardViewSection` keeps the board controls
visible whenever `list.projectId` is set even if the grant is later revoked. We
never strand someone inside a feature they are already using.

---

## What we are explicitly NOT building

These would cost the product its identity:

- **Arbitrary user-defined custom fields** (GitHub Projects' core idea, and the
  fastest way to become a spreadsheet).
- **Fully custom per-team workflow state machines.** Inbox / Ready / Doing /
  Waiting / Done, plus rename/reorder and custom non-Done statuses, is the
  ceiling.
- **Triage SLAs, internal-helpdesk Asks, customer-request pipelines.**
- **Sub-teams and workspace admin hierarchies.**

If a Project Mode task starts growing toward one of these, stop and re-scope it.

---

## Sequencing

- **Tier 0** — fixes things that are currently *wrong* for teams (shared boards
  disagreeing about status; `ProjectMember` unused; no terminal state other than
  completed). Nothing else is trustworthy until these land.
- **Tier 1** — cheap, mostly independent, delivers most of the perceived
  capability: identifiers, labels, command palette, activity history,
  notification inbox, server-side search.
- **Later** — project objects, estimates, relations, cycles, shared views,
  timeline, PR→status automation, insights. Deliberately unscheduled; they get
  scoped from evidence once real teams are on Tier 0–1.

## Working agreements

- **TDD.** RED regression test naming the task id → green → `npm run predeploy`.
  Schema changes ship with their Prisma migration in the same PR.
- **Reuse before you write.** Permissions go through `lib/list-permissions.ts` /
  `lib/list-member-utils.ts` — never inline `ownerId === user.id`. All
  user-facing copy is an i18n key, never a string literal. Run
  `npm run check:reuse`.
- **Cross-platform.** Anything changing who-can-do-what or what words the user
  sees updates [PRODUCT_CONTRACT.md](../PRODUCT_CONTRACT.md) in the same PR; any
  wire change updates `lib/api-contracts/v1-ios-shapes.ts` and
  `tests/api/v1-contract.test.ts`.
- **Every `brands/` profile must pass `npm run check:brands` with
  `projectMode` off.** A consumer-only brand is a first-class target, not a
  degraded one.
