# Astrid API Contract

This document defines the stable API contract between the Astrid web backend and mobile clients (iOS, Android). Changes to these endpoints follow strict versioning and deprecation policies.

## API Versioning

### Current Version: v1

The API version is communicated via the `X-API-Version` header:

```http
X-API-Version: 1
```

### Version Policy

- **Current version**: 1
- **Minimum supported version**: 1
- **Breaking change policy**: 6-month deprecation notice before removal

### What Constitutes a Breaking Change

**Breaking (requires version bump):**
- Removing a field from response
- Changing a field's type
- Renaming a field
- Making an optional field required
- Changing enum values

**Non-breaking (can add anytime):**
- Adding new optional fields
- Adding new endpoints
- Deprecating (but not removing) fields

**Scope corrections (2026-08-29, task 36d0f047):** `PUT /api/v1/notifications` and
`POST /api/v1/feature-requests` now require `user:write` (they previously accepted
`user:read`). This is a deliberate break for tokens minted from the `readonly`
scope preset, which were never meant to mutate: a read-only token could mark the
whole inbox read or file feature requests. Full-access and first-party tokens
already carry `user:write` and are unaffected.

### Route Structure

The API has two route layers:

- **`/api/v1/*`** — Versioned endpoints for external clients (mobile, SDK, OAuth). These are the stable contract.
- **`/api/*`** — Internal/legacy endpoints used by the web app directly (auth, SSE, cron jobs, health checks).

When building mobile or external integrations, always use `/api/v1/` routes. The non-versioned routes may change without notice.

---

## Polling agent lifecycle

`GET /api/v1/agent-queue?agent=<mailbox>&listId=<board>` keeps Ready work in
`queue` and conversations in `attention`. `agent` is a built-in mailbox or a
Custom Agent address (`<name>.oc@<domain>`); a Custom Agent is accepted only
for the agent's own token or the person who registered it, and any other caller
gets the same 400 as an unknown agent (AWTD-1642). An optional `attention.tasks[].resume`
object identifies a reply to an explicit, agent-authored human handback:

```json
{
  "listId": "board UUID",
  "assigneeId": "current human assignee",
  "handbackCommentId": "agent question comment",
  "replyCommentId": "human reply comment",
  "commentWatermark": "2026-10-25T10:00:00.000Z"
}
```

The response also includes the additive, versioned `runnable` verdict:

```json
{
  "runnable": {
    "version": 1,
    "hasWork": true,
    "reasons": ["attention"],
    "incomplete": false
  }
}
```

`hasWork` includes Ready tasks and unanswered attention items; `reasons` names
which are present (`ready`, `attention`). `incomplete` is true when the queue or
attention read was truncated or a part of attention was skipped. Consumers
may prefer this verdict when present. `incomplete` says the read was partial; it is
not by itself work, because a token without the chat scopes skips part of attention
on every poll. No shipped skill or loop recipe reads the field yet. Existing `empty`, `hint`, `queue`, and `attention` values and ordering
are unchanged. Older servers omit `runnable`; clients should then retain their
existing `empty`-based behavior.

**Guidance for the queued tasks.** Additive, and absent when empty:
- `listInstructions[]`: `{ listId, listName, instructions, truncated }`, one per queued task's first
  list. `instructions` is the list description (at most 4000 characters) wrapped as untrusted
  guidance (AWTD-1689).
- `projectGoals[]`: `{ listId, projectId, projectName, goals, guardrails, instructions }`, one per
  queued task's first list whose project states goals or guardrails (ADEV-179, keyed by list since
  ADEV-190, the same way as `listInstructions`). `instructions` is the same statement as markdown
  wrapped as untrusted guidance. A failed read leaves the field out rather than failing the poll.
- `orchestrationPolicy[]`: the named board's effective policy as this agent sees it (ADEV-36); only
  with `listId`.

**A polling-only agent the caller turned Off (AWTD-1563).** Inert unless the
server sets `ASTRID_AGENT_EXECUTION_MODE_HONOR_OFF=true`. Then, for a
polling-only mailbox (`codex`) whose stored mode is `off`, the response has
`mode: "off"`, `empty: true`, an empty `queue` and `attention`,
`runnable.hasWork: false`, and a `hint` saying the agent is turned Off. Every
other mailbox, and `codex` without a stored Off, is unchanged. Clients should
treat `mode: "off"` as "stop polling until the user turns it back on".

**Explicit business runtime bindings (AWTD-1667).** Inert unless the server sets
`ASTRID_RUNTIME_BINDING_RESOLVER=true`. Even then, a response for a board with no
binding, or for a request with no `listId`, is unchanged byte for byte. When the
named board does carry a binding:

- **Usable binding.** The response gains `runtimeBinding: { id, revision }` and
  `mode: "polling"`. Credential and payer references are never included.
- **Unusable binding.** The server answers **403** with `{ error, reason,
  bindingId, boardId }`. "Unusable" means the binding is missing, unreadable,
  inactive, unapproved, out of scope, or lacks a credential or business payer.
  This is a denial, never an empty queue or the caller's personal mode.

Clients should treat an unknown `reason` as a denial.

**Runtime-binding pilot (AWTD-1669).** Inert unless the server sets BOTH
`ASTRID_RUNTIME_BINDING_RESOLVER=true` and `ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS=true`;
with either off, every response below is unchanged byte for byte. When both are on:

- **Discovery.** A task on a bound board appears in `get_agent_queue` (with or
  without `listId`, in `queue`, `held`, `attention` and handbacks) only when the
  caller authenticated with the OAuth client enrolled as the binding's runtime
  (`runtimeSubjectId`) and the agent is one the binding allows. A task that also
  sits on a board bound to a different binding is shown to nobody. Naming a bound
  board as someone else answers 403 `principal-not-runtime`.
- **Claims.** `POST /api/v1/tasks/:id/claim-fixall` and `POST /api/v1/tasks/:id/claim`
  (MCP `claim_task`) on a bound task are refused unless the same runtime and an
  allowed agent ask. A claim is fenced: at most `maxConcurrentRuns` (1 in the pilot)
  bound tasks are in Doing across every board and agent sharing the binding. A
  refusal is `{ error, reason, bindingId, boardId }` from `claim-fixall`, or
  `{ outcome: "binding_denied", task: null, binding: { reason, bindingId, boardId, message } }`
  from `/claim`. The status is **409** for `capacity-exhausted` (busy, like a lost
  race) and **403** for every other reason, including `board-conflict` (the task's
  bound boards disagree, or `listId` names one of its unbound boards) and
  `transport-unsupported` (a native Copilot dispatch claim).
- No response carries a credential or payer reference.

**Admin enrollment of runtime bindings (AWTD-1668).** Web-only admin routes under
`/api/v1/admin/runtime-bindings`; no iOS or SDK client calls them. Every route
needs a deployment admin (`AdminUser`). Changes also need a browser session, so an
OAuth or access token gets 403 `session-required`. All changes except suspend,
revoke and detach are refused with 403 `deployment-not-single-business` unless the
server sets `ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS=true`, which is off by default.

- `GET /` returns `{ enrollmentEnabled, bindings: [{ binding, attachedBoards, availableActions }] }`.
  `POST /` enrolls a binding (pending, revision 1) and answers 201 `{ binding }`.
- `GET /:id` returns the binding, its attached boards and its revisions. `PATCH /:id`
  changes the configuration (`expectedRevision` is optional) and always writes a new
  revision. A broadening returns the binding to `pending`.
- `POST /:id/lifecycle` takes `{ action: verify|approve|activate|suspend|revoke, expectedRevision? }`.
- `POST /:id/boards` takes `{ boardId }` and attaches the board.
  `DELETE /:id/boards?boardId=` detaches it.

A refusal is `{ error, code, details? }`. `error` is an explanation for the admin
and `code` is machine-readable. A held multi-board conflict is 409 `board-conflict`
with `details.conflictingBoards`. A stale revision is 409 `revision-conflict`.

`POST /api/v1/tasks/:id/claim-fixall` (`tasks:write`, existing task access)
accepts the additive `resume` action. Send `{ action: "resume", agent,
commentWatermark: resume.commentWatermark, resume, listId: resume.listId }`. The server independently
revalidates the mailbox-authored `AGENT-HANDBACK` question, current assignee's
subsequent reply, named allowed board, incomplete Waiting state, due date, task
version and comments before an exclusive conditional update to Doing + agent
assignment. Stale, edited, reassigned, cross-board and concurrent claims return
409 without overwriting state. Malformed metadata returns 400. Existing
`ready`, `recheck` and `review` requests and responses are unchanged.

All actions accept optional `listId` to pin membership to one allowed board;
new launchers should supply it. The additive recovery action `pause` requires
that explicit board, `taskVersion` and an ISO `commentWatermark`; one conditional
update parks only a still-owned Doing task with unchanged task/comment versions
in Waiting. It cannot claim an unassigned or human-owned task.
The native bridge's Copilot `ready` claim additionally sends `nativeDispatch:
{ repository, issueNumber }`. The exclusive claim and agent-authored
`NATIVE-COPILOT-CLAIM` binding are committed in one database transaction.
Recovery requires that exact board/task/repository/issue binding; an inert
GitHub mirror alone never proves ownership after a lost or uncertain claim.

The MCP task create/update tools also accept `assigneeId: null` for explicit
unassignment. Omission preserves the API's existing defaults and is not a reliable
way to create unassigned work. Declared MCP agent writes resolve through the
authenticated queue on fresh stateless requests and never fall back to a human
when identity lookup fails.

This resumes a task; it grants no deployment, migration or native release
privileges. The full operational contract is
[FIXALL_WORKFLOW.md](./FIXALL_WORKFLOW.md#a-human-reply-resumes-an-explicit-handback).

## Authentication Endpoints

### POST `/api/auth/apple`
Sign in with Apple.

The `identityToken` is verified against Apple's JWKS (issuer + signature) and additionally checked for `aud` (must equal our client id), `email`, and `email_verified`.

**Request:**
```json
{
  "identityToken": "string",
  "authorizationCode": "string",
  "user": "string",
  "email": "string",       // optional
  "fullName": "string"     // optional
}
```

### POST `/api/auth/google`
Sign in with Google.

The `idToken` is verified against Google's JWKS (issuer + signature) and additionally checked for `aud` (must equal our client id), `email`, and `email_verified`.

**Request:**
```json
{
  "idToken": "string"
}
```

### GET `/api/auth/mobile-session`
Get current session information.

**Response:**
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "image": "string"
  }
}
```

### DELETE `/api/auth/signout`
Sign out the current user.

### POST `/api/auth/desktop/grant`
Mint a one-time hand-off code for a native desktop app. Cookie-authenticated: the
code is always for the **session** user, never for a user named in the body.

Body: `{ client, state, codeChallenge, codeChallengeMethod: "S256" }` →
`{ redirectUrl }`, a URL on the app's own scheme carrying `code` and `state`.

`plain` PKCE is rejected. The redirect URI is a per-client constant and is never
read from the request, so this cannot be turned into an open redirect.

### POST `/api/v1/auth/desktop/exchange`
Trade a hand-off code plus its PKCE verifier for a session. Unauthenticated by
design — the code is the credential.

Body: `{ client, code, codeVerifier }` →
`{ sessionToken, expiresAt, sessionCookieName, user, meta }`.

The token is returned in the body, never as a `Set-Cookie`: the caller stores the
credential itself. `sessionCookieName` is stated because a native client holds a
whole `Cookie` header and has to pick a name before it has ever seen a server
cookie — production uses the `__Secure-` prefix and development does not.

Codes are single-use, hashed at rest, and expire in five minutes. A wrong
verifier burns the code rather than allowing another attempt.

---

## Task Endpoints

### GET `/api/v1/tasks`
List the tasks the caller can see. Scope: `tasks:read`.

**Query parameters**

| Parameter | Meaning |
|---|---|
| `listId` | only this list's tasks; caller must have access to it. Without it, the read is the caller's own tasks (created, assigned, or on a list they own or belong to) — tasks in public lists they have no tie to are NOT included; read those by `listId` |
| `completed` | `true` / `false`. Absent means both |
| `priority` | `0`–`3` |
| `assigneeId`, `assigneeEmail` | filter by assignee (email is case-insensitive) |
| `statusRole` | board column, or `none` for Inbox — the tasks carrying no status |
| `limit`, `offset` | default 100, capped at 1,000; default offset 0 |
| `cursor` | keyset paging instead of `offset` — empty (`?cursor=`) starts a walk, then send each page's `nextCursor`. A malformed value is a `400`. See *Sync cursor* below |
| `includeComments` | `true` embeds up to 20 comments per task, newest first |
| `updatedSince` | ISO timestamp — delta sync. The response then also carries `deletedIds`, because tasks are hard-deleted and an incremental client would otherwise keep showing them. An unparseable value is ignored rather than applied |
| `omit` | comma-separated fields to leave out: `description`, `listMembers` |
| `leanListMembers` | `1` — the older spelling of `omit=listMembers`, still supported |

**`omit` — the list view should not pay for the sync's payload**

This route does two jobs: it is a list view's read and a client's full sync. A
list view needs titles; only the sync needs descriptions. Measured 2026-10-12,
`?limit=1000` was 551.8 KiB on the wire against a 500 KiB budget and
`description` was **443.3 KiB — 80%** of it.

So `description` is **opt-out, not optional** (AWTD-1233 → AWTD-1236):

```http
GET /api/v1/tasks?limit=1000&omit=description
```

- **Omitting the parameter returns exactly the response it always did.** This
  is additive; no client has to change, and each one drops the bytes when it
  has somewhere else to read a description from — `GET /api/v1/tasks/{id}` or
  the task event, both of which carry the full shape.
- An omitted field is **absent from the task object, not `null`**. `null`
  already means "this task has no description", and a client that cannot tell
  "not sent" from "empty" will overwrite good text with none. Apply an omitted
  field as *unchanged*, never as empty.
- **Unrecognised names are ignored**, not rejected, so a newer client naming a
  field this build has never heard of still gets a usable response. The
  trade-off is that a typo silently returns the full payload — so the response
  echoes what the server actually dropped:

```json
{ "tasks": [ … ], "meta": { "total": 1000, "limit": 1000, "offset": 0,
  "apiVersion": "v1", "authSource": "oauth", "omitted": ["description"] } }
```

  `meta.omitted` is **absent** on a full response. A caching client should read
  it before writing rows to disk.
- Only `description` and `listMembers` may be dropped. Identity, status and the
  permission fields (`lists[].ownerId`) are not droppable: a response without
  them is not lean, it is broken.

**Sync cursor — `serverTime` and `nextCursor` (AWTD-1470)**

Additive; an existing client sees one new top-level key and nothing else.

- **`serverTime`** (ISO) is on every `GET /api/v1/tasks` and `GET /api/v1/lists`
  response. It is the server's clock read **before** the query, so a write that
  lands while the query runs is newer than it. Send it back as the next
  `updatedSince` instead of the device clock — no more `stamp − 5 min` skew
  margin.
- **`?cursor=`** walks the tasks in `(updatedAt, id)` order. Each page that has
  more rows carries **`nextCursor`** (opaque — do not parse it); the last page
  has none. Unlike `offset` over the default order, a task edited mid-walk
  cannot shift another row off a page: an edit moves its row to the tail, so a
  row not yet returned comes once, and one already returned comes again with
  its new state (upsert by id). `updatedSince`, `listId` and the other filters
  compose with it; `deletedIds` still accompanies a delta.
- `offset` paging is unchanged and still the default; an offset page never
  carries `nextCursor`. `/api/v1/lists` is not paged, so it never carries one
  either.

```http
GET /api/v1/tasks?limit=1000&cursor=
→ { "tasks": [ … ], "serverTime": "2026-11-01T15:00:00.000Z",
    "nextCursor": "eyJ1Ijoi…", "meta": { "total": 2500, "limit": 1000, "offset": 0, … } }
GET /api/v1/tasks?limit=1000&cursor=eyJ1Ijoi…
```

The wire fixture is `task.listPage.cursor` in `contracts/fixtures/wire-shapes.json`.

### POST `/api/v1/sync/existence`
Which of a client's cached ids it can no longer read (AWTD-1515). `deletedIds`
only covers hard deletes; a list the caller was removed from, or a task that
moved somewhere private, never shows up in a delta. This replaces one
`GET /api/v1/tasks/{id}` per cached row.

```http
POST /api/v1/sync/existence
{ "taskIds": ["…", "…"], "listIds": ["…"] }
→ { "missingTaskIds": ["…"], "missingListIds": [], "maxIds": 200,
    "meta": { "apiVersion": "v1", "authSource": "oauth" } }
```

- **Missing means exactly what the per-row GET means**: an id is listed when
  `GET /api/v1/tasks/{id}` / `GET /api/v1/lists/{id}` would answer 403, 404 or
  410 — deleted, never existed, or no longer visible to the caller. The route
  reads with the same access clause those GETs use. Drop missing rows from the
  cache.
- Either kind may be omitted; both arrays always come back. Order is the
  request's, duplicates once. Ids only — a human identifier (`AST-142`) is not
  resolved and comes back missing.
- At most **`maxIds` (200) per kind** per request; more is a `400` whose
  `error` names the limit. A malformed body is a `400`.
- Scopes: `tasks:read` to ask about tasks, `lists:read` to ask about lists
  (either one admits the request; asking about a kind without its scope is a
  `403`).

The fixture is `contracts/fixtures/sync-existence.json`.

### GET `/api/tasks`
Fetch all tasks accessible to the current user.

**Response:**
```json
{
  "tasks": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "completed": false,
      "isPrivate": false,
      "repeating": "never",
      "repeatFrom": "DUE_DATE",
      "occurrenceCount": 0,
      "priority": 0,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "creatorId": "string",
      "assigneeId": "string",
      "dueDateTime": "2024-01-01T00:00:00Z",
      "isAllDay": true,
      "lists": [{ "id": "string", "name": "string" }],
      "creator": { "id": "string", "name": "string", "email": "string" },
      "assignee": { "id": "string", "name": "string", "email": "string" }
    }
  ]
}
```

### GET `/api/tasks/{id}`
Get a specific task by ID.

### POST `/api/tasks`
Create a new task.

**Request:**
```json
{
  "title": "string",
  "description": "string",
  "priority": 0,
  "repeating": "never",
  "isPrivate": false,
  "dueDateTime": "2024-01-01T00:00:00Z",
  "isAllDay": true,
  "listIds": ["string"],
  "assigneeId": "string"
}
```

### PUT `/api/tasks/{id}`
Update an existing task.

**Request:** Partial task object with fields to update.

### DELETE `/api/tasks/{id}`
Delete a task.

### PUT `/api/tasks/{id}` (completion)
Mark task as complete/incomplete.

**Request:**
```json
{
  "completed": true
}
```

### POST `/api/tasks/{id}/copy`
Copy a single task.

### POST `/api/tasks/copy`
Batch copy multiple tasks.

**Request:**
```json
{
  "taskIds": ["string"]
}
```

---

## List Endpoints

### GET `/api/lists`
Fetch all lists accessible to the current user.

**Response:**
```json
{
  "lists": [
    {
      "id": "string",
      "name": "string",
      "privacy": "PRIVATE",
      "ownerId": "string",
      "color": "string",
      "imageUrl": "string",
      "description": "string",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### GET `/api/lists/{id}`
Get a specific list by ID.

### POST `/api/lists`
Create a new list.

**Request:**
```json
{
  "name": "string",
  "description": "string",
  "color": "string",
  "privacy": "PRIVATE"
}
```

### PUT `/api/lists/{id}`
Update an existing list.

`color`, when sent, must be a six-digit hex string (`#rrggbb`); anything else
is rejected with 400 `Invalid color (must be #rrggbb)`. The same rule applies
to `PUT /api/v1/lists/{id}`. Only the fields sent are changed on v1, so
`{ "color": "#22c55e" }` alone is a valid recolour.

`projectId` moves the list (AWTD-1702): `<id>` attaches, `null` detaches, another id moves
between projects. It needs the **list's owner/admin AND the owner or an admin of every
project the list enters or leaves**. A refusal is 403 with `code`
`PROJECT_ATTACH_FORBIDDEN` (destination) or `PROJECT_DETACH_FORBIDDEN` (the project it
leaves); an unknown destination is 404. Re-sending the project the list is already in is a
no-op that asks nothing. Tasks move with the list; no data is rewritten.

### POST `/api/v1/lists` — `projectId`
Optional. Creates the list **in** that project in the same write (no create-then-PUT). The
caller must be the project's owner, admin or member, else 403 `PROJECT_CREATE_FORBIDDEN`;
unknown project is 404. Gated by Project Mode like `/api/v1/projects`.

### DELETE `/api/lists/{id}`
Delete a list.

### PUT `/api/lists/{id}/invite`
Invite users to a list.

**Request:**
```json
{
  "emails": ["user@example.com"]
}
```

### DELETE `/api/lists/{id}/leave`
Leave a shared list.

### PUT `/api/lists/{id}/favorite`
Toggle list as favorite.

**Request:**
```json
{
  "favorite": true
}
```

---

## Project Board Endpoints

### GET|PUT `/api/v1/projects/{id}/board-rows`
Which lists the caller's multi-list project board shows as rows (AWTD-1660),
saved per person per project so the choice follows them across devices. Rows
draw in the saved order; the board's status columns are the project's own
(`getProjectBoardColumns`).

- Gated on Project Mode: 404 when the deployment does not ship it, 403
  `reason: "not_granted"` when the caller has not been given it.
- The project's owner or a member only (otherwise 403; unknown project 404).
- `GET` scope `projects:read`; `PUT` scope `projects:write`.

**GET response:** `listIds` is `null` when nothing has been saved, which a
client draws as the project's own lists. Saved ids the caller can no longer see
are left out.
```json
{ "listIds": ["list-a", "list-b"], "meta": { "apiVersion": "v1" } }
```

**PUT request:** at most 100 ids, de-duplicated in order. `[]` is an empty
board. Any list the caller cannot see refuses the whole write with 403 and is
named in `listIds`.
```json
{ "listIds": ["list-b", "list-a"] }
```

### GET|PUT `/api/v1/lists/{id}/orchestration-policy` and `/api/v1/projects/{id}/orchestration-policy`
The orchestration policy (AWTD-1693; rules in astrid-core's [ORCHESTRATION_POLICY.md](https://github.com/Graceful-Tools/astrid-core/blob/main/docs/ORCHESTRATION_POLICY.md), D71).
It decides who takes unassigned Ready work, what an agent may do alone (merge, deploy, migrate
additive or destructive, release, spend, each `allowed`, `ask` or `never`), and who it asks. A
project stores one policy and each list may override it field by field. An absent key inherits.
Nothing stored is the core's default, which is today's behaviour: every action `never`, any agent
claims, questions go to the list owner.

- **List.** `GET` (scope `lists:read`) is open to anyone with a role on the list, agents included,
  and is 404 otherwise, public lists too. `PUT` (scope `lists:write`) is for the list's owner or an
  admin (`canEditListSettings`).
- **Project.** `GET` (scope `projects:read`) is for its owner and members. `PUT` (scope
  `projects:write`) is for its owner or an admin (`canUserManageProject`).
- **An agent never writes a policy**, whatever its token's scopes: 403.
- **The trade-off policy** (ADEV-281, core D72, `docs/specs/GOALS_GUARDRAILS_SIGNALS.md` → 6) is a `tradeoff` key
  beside `routing`, `autonomy` and `escalation`: `{ goalOrder?, risk?: { reviewAt?, refuseAt? }, guardrail?:
  { reviewAtBreachProbability?, refuseAtBreachProbability? }, experimentFirst?: { confidenceBelow?, riskAtLeast? },
  minConfidenceToAct? }`, levels being `low`, `medium` or `high` and probabilities 0 to 1. **Nothing stored is no
  policy**: `effective.tradeoff` is absent, no estimate is labelled and the Policy sort is not offered. A stored
  `{}` states one, on the defaults. Three actions join `autonomy`, each `never` by default: `promoteIdea` (moving
  a `do-now` idea, with confidence at least `minConfidenceToAct`, to Ready), `experimentStart` and `experimentStop`.
  A write that changes `tradeoff` queues a bounded re-evaluation of the project's latest estimates; stored labels
  follow within a job or two.
- `PUT { "policy": <PolicyOverride> | null }`. `null` clears it. A value the rules do not know
  (`"merge": "sometimes"`, a probability of 1.5) is a 400, and so is an unknown key. People named under `escalation` must
  be on the list, or on one of the project's boards.

**List GET / PUT response:** `effective` is resolved by astrid-core (`orchestrationPolicy`).
`engine` is `core`, or `typescript` if the vendored build could not answer and the mirror did.
```json
{
  "listId": "l1", "projectId": "p1",
  "project": { "autonomy": { "merge": "allowed", "deploy": "allowed" } },
  "list": { "autonomy": { "merge": "ask" } },
  "effective": {
    "routing": { "assignTo": null, "agents": null },
    "autonomy": { "merge": "ask", "deploy": "allowed", "migrate": { "additive": "never", "destructive": "never" }, "release": "never", "spend": "never", "promoteIdea": "never", "experimentStart": "never", "experimentStop": "never" },
    "escalation": { "to": "listOwner" }
  },
  "engine": "core",
  "canEdit": { "list": true, "project": false },
  "meta": { "apiVersion": "v1" }
}
```
The project routes answer `{ projectId, project, effective, engine, canEdit, meta }`, where
`effective` is the project's policy over the default. Over MCP, agents read it with
`get_orchestration_policy { listId | taskId }`.

### GET|PUT `/api/v1/projects/{id}/goals` and GET `/api/v1/lists/{id}/goals`
A project's goals and guardrails (ADEV-179): what it is for and what it must not do, read by the
people and agents working in it so guidance can stay short. Stated per project; a list answers its
project's. Shape and rules: `lib/goals-guardrails.ts`, the one place they are read.

- **Project.** `GET` (scope `projects:read`) is for everyone working in the project: its owner, its
  members and anyone with a role on one of its lists, agents included; 404 otherwise. `PUT` (scope
  `projects:write`) is for its owner or an admin (`canUserManageProject`).
- **List.** `GET` (scope `lists:read`) for anyone with a role on the list. A list in no project
  answers empty lists and `projectId: null`. There is no list `PUT`.
- **An agent never writes them**, whatever its token's scopes: 403. Guardrails bound what agents do.
- `PUT { goals, guardrails }` replaces both. The server trims every field, drops items with a blank
  statement and empty optional fields, defaults `kind` to `stated`, and gives each item without an
  id the first free `g1, g2…` / `r1, r2…`. `null`, or both lists empty, clears it. Limits: 12 goals,
  20 guardrails, 500 characters a statement, 120 a measure, target or current value; a duplicate id
  or an unknown `kind` is a 400.
- Clients only display and send: all normalising is the server's, so there is no contract fixture.
  Show goals in order with their measure, `Target: …` and `Now: …`; mark `enforced` guardrails.

**Response** (lists add `listId`; `projectName` and `projectId` are null for a list in no project):
```json
{
  "projectId": "p1", "projectName": "Fund",
  "goals": [{ "id": "returns", "statement": "Maximise long-term returns", "measure": "IRR", "target": "≥ 8%/yr", "current": "6.1%" }],
  "guardrails": [
    { "id": "law", "statement": "Break no applicable laws", "kind": "stated" },
    { "id": "r1", "statement": "No more than 20% in one position", "kind": "enforced" }
  ],
  "canEdit": true,
  "meta": { "apiVersion": "v1", "authSource": "oauth" }
}
```
`stated` guardrails are judged by whoever reads them; `enforced` ones are meant for a program to
check (ADEV-182). Agents get the same statement in their prompt and payloads (`projectGoals` on the
webhook task and the agent queue), and over MCP with `get_project_goals { listId | projectId | taskId }`.

**Measures and enforced checks (ADEV-182).**
- `PUT /api/v1/projects/{id}/goals/{goalId}/measure { current, taskId? }` records a goal's new value
  and answers like GET. Open to everyone working in the project, agents and scripts included (scope
  `projects:write`); the goal keeps its latest 20 changes in `history: [{ value, by, at, taskId? }]`
  (`by` is a user id or an agent mailbox). A `current` changed through `PUT …/goals` is recorded the
  same way; a submitted `history` is ignored. MCP: `update_goal_measure { goalId, current, projectId |
  listId | taskId }`.
- **Typed metric (ADEV-270).** A goal may carry `metric: { unit?, direction: "up" | "down", target?,
  baseline?, current?, measuredAt?, source?: { connectorId, metricKey }, staleAfterHours? }` beside its
  free text. `current` and `measuredAt` are the server's: a `PUT …/goals` never overwrites them.
  `direction: "down"` is met at or below `target`. **A `PUT …/goals` that leaves `metric` out keeps the
  stored block; an explicit `metric: null` clears it.** Without `metric` a goal reads exactly as before
  (first number in `target` / `current`). History entries gain `num?`, `source?: "human" | "agent" |
  "push" | "pull"` and `externalId?`.
- The measure `PUT` also accepts `{ value, unit?, at?, externalId?, taskId? }` (`value` a number or numeric
  string; `at` an ISO time, default now). It records `num`, and updates `metric.current` / `measuredAt` when
  the goal has a `metric`. **A repeated `externalId` already in the goal's history is a no-op** (200, same
  body). `{ current }` still works.
- GET adds `workByGoal: { [goalId]: taskCount }`: tasks of the project linked to the goal (see
  *Goal links* below), directly or through a list. Agents end a completion or handback report with a
  `GOAL: g1, g2` line, which links the task.
- An `enforced` guardrail may carry `check: { type: "policy", field, atLeast: "ask" | "never" }`
  (`field` is `merge`, `deploy`, `migrateAdditive`, `migrateDestructive`, `release` or `spend`). It is
  violated while the board's effective orchestration policy lets agents do `field` more freely than
  `atLeast`; `scripts/land-and-deploy.ts` then holds the merge, or the deploy and its migrations, and
  names the guardrail in the run summary. Custom script checks are not built yet.

### GET|PUT|DELETE `/api/v1/tasks/{id}/goals` and `/api/v1/lists/{id}/goal-links`
*Goal links* (ADEV-271, spec: `docs/specs/GOALS_GUARDRAILS_SIGNALS.md`): which of its project's goals a
task or a list serves. Project Mode only (404 where it is compiled out, 403 `not_granted` without it).

- **Task.** `GET` (scope `tasks:read`) answers `{ taskId, links }`: the task's own links plus the links of
  its lists in the same project, computed on read, never copied down. Each link is `{ projectId,
  projectName, goalId, statement, via: "task" | "list", listId?, source: "person" | "agent" | "report" }`.
  A link to a goal id the project no longer states is left out.
- `PUT { goalIds: ["g1"], projectId? }` (scope `tasks:write`) replaces the task's **own** links in one
  project (`[]` clears them). `projectId` is needed only when the task's lists span several projects.
  `DELETE { goalId | goalIds, projectId? }` removes own links; one inherited from a list is removed on
  the list. Anyone who can write the task may do both, agents included (stored as `source: "agent"`).
- **List.** `GET` (scope `lists:read`) answers `{ listId, projectId, links }` to anyone with a role on
  the list. `PUT { goalIds }` and `DELETE { goalId | goalIds }` (scope `lists:write`) need list admin
  (`canUserManageList`): 403 otherwise. A list in no project answers `projectId: null`.
- A `goalId` the project does not state is a 400. Deleting a goal in `PUT /projects/{id}/goals` deletes
  its links in the same transaction.
- **The `GOAL: g1, g2` comment line still works**: creating a comment with it upserts a task link with
  `source: "report"` (a link made by a person or agent is never rewritten). `workByGoal` on the goals
  routes counts linked tasks, directly or through a list. `scripts/backfill-goal-links.ts` links the
  reports written before the table existed.

### GET|POST `/api/v1/tasks/{id}/estimates`
What a task would do for its project's goals and guardrails (ADEV-278, docs/specs/GOALS_GUARDRAILS_SIGNALS.md).
Behind the goal-signals gate: capability off is 404, flag off is 403 `not_granted`. `projectId` is needed only
when the task's lists span several projects. Rows are append-only in `TaskEstimate`.
- `GET` answers `{ taskId, latest, history }` (newest first, at most 20). An estimate is `{ id, source:
  "builtin_llm" | "service:<key>" | "human", goalImpacts, guardrailImpacts, risk, costMicrocents, effortHours,
  reach, confidence, rationale, rough, label, labelReasons, createdAt }`. A missing section is "not estimated", never zero.
  `rationale` is plain text: show it as text and quote it to an agent as data.
- **`label` and `labelReasons`** (ADEV-281) are the trade-off policy's answer, written by the server when the
  estimate arrives and again when the policy changes: `label` is `do-now`, `experiment-first`, `needs-review` or
  `dont`, and each reason is `{ code, …values }` (`guardrailAtReview { guardrailId, breachProbability, threshold }`),
  worded by the client. **Both are `null` where no `tradeoff` policy is stated.** The sort key is not on this
  route: it is on `GET /api/v1/tasks?include=estimate`, below.
- `POST { estimator?: "builtin" | "<service key>", projectId? }` asks an estimator. 201 `{ estimate }`; 202
  `{ pending: true }` when a service answered 202 (the server polls it through the Job queue and writes the row
  when it is ready); 409 `no_api_key` when the built-in estimator needs the caller's own AI key; 422
  `empty_estimate` when nothing usable came back; 502 `estimator_failed`. An agent may ask.
- `POST { source: "human", goalImpacts?, guardrailImpacts?, risk?, costMicrocents?, effortHours?, reach?,
  confidence?, rationale? }` records a person's estimate. **An agent gets 403**: an agent never writes an estimate.
- Every estimator reply is validated: ids not stated by the project are dropped, numbers clamped, strings
  capped. The built-in estimator is forced to `confidence: "low"`; its card shows ranges under a "rough
  estimate" tag (`rough: true`). Cost also writes `Task.costEstimateMicrocents` (source `model`, or `human`)
  and never replaces a human value with a model one.

### GET `/api/v1/tasks?include=estimate`
Each task's latest trade-off label and sort key (ADEV-281), for the **Policy** sort. Opt-in, like `include=fields`,
because the full task response is near its wire budget and only that sort reads them. A task carries
`estimate: { label, labelReasons, sortKey }` only when its latest estimate has a label, so there is **no key at all**
on a project with no policy. `sortKey` is a list of integers compared lexicographically, smaller first; a client
compares it and never derives it (astrid-core `sort_by_setting`, the `policy` arm). A list saved as `sortBy:
"policy"` reads as Auto on a client that does not know it.

### GET|POST|DELETE `/api/v1/tasks/{id}/experiment`, POST `…/experiment/refresh`
A task's experiment links and post-deploy verification windows (ADEV-279, spec:
`docs/specs/GOALS_GUARDRAILS_SIGNALS.md` → *5. Experiments and verification*, *7. The Pending results lane*).
Behind the goal-signals gate (404 where the capability is off, 403 `not_granted` without the flag), which is
read per project from its owner by the settle job. Rows are in `TaskExperiment`. `projectId` is needed only when
the task's lists span several projects. **Astrid computes no statistics**: an experiment's deltas, intervals,
significance, verdict and recommendation are its service's, stored as given (clipped), never recomputed.
- `GET` answers `{ experiments, inResultsColumn }`. A link is `{ id, kind: "experiment" | "verification",
  connectorId, externalKey, url, state: "pending" | "running" | "concluded" | "stopped" | "unknown", verdict:
  "improving" | "flat" | "regressing" | "inconclusive" | null, recommendation: { action, reason } | null, metrics,
  findings, startedAt, decideBy, fetchedAt, stale, lastError }`. `stale` is "no data since `fetchedAt`" (48 h).
- `POST { kind: "experiment", connectorId, externalKey, url?, decideBy? }` links a task to an experiment on one of
  the project's `experiment` connectors (404 for any other). `POST { kind: "verification", days | decideBy }`
  starts a verification window and records the project's fresh goal and guardrail values now (the deploy); at
  `decideBy` the project's sources are read and compared: a guardrail breached or a goal regressed is `regressing`,
  otherwise `improving` if anything could be compared, else `inconclusive` (unknown is never a pass). 201
  `{ experiment }`. At most 10 links per task.
- `DELETE ?experimentId=` removes one link. `POST …/refresh` reads every open link now and answers the same view
  plus `lane`: what the lane rules did (`not-in-column`, `stay`, `completed`, `handed-back`, `skipped`).
- **A link reports on every board.** The moment one concludes, a system comment on the task names the verdict and
  the numbers. Nothing moves, completes or hands back a task that is not in the **Pending results** column.
- **In the column** (a board added it; no migration, gate, connector or link ever does): entering needs an open
  experiment or a verification with `decideBy` ahead, else 422 `RESULTS_NEEDS_CONDITION` (the client's cue to
  show the picker); entering unassigns the task and remembers the holder. Then `/api/cron/results-settle` (every
  15 minutes, bounded, stalest link first) or a Refresh asks astrid-core's `resultsSettle`: every link
  `improving` completes the task with a system comment and a goal measurement naming the task; a regression, an
  inconclusive result at `decideBy`, or a source silent past `decideBy` hands the task back to the policy's
  escalation target with a Decision (iterate, roll back, ship anyway). Nothing rolls back automatically.

### Project connectors: `/api/v1/projects/{id}/connectors`
A project's bindings to outside services (ADEV-277, spec: `docs/specs/GOALS_GUARDRAILS_SIGNALS.md` →
*Connectors*). Behind the Goal Signals gate (404 where the capability is off, 403 `not_granted` without
the flag). **Owner or admin only, never an agent**: a plain member gets 403, a stranger 404, an agent
403 on every route here.

- `GET` (scope `projects:read`) answers `{ connectors }`. `POST { kind, serviceKey, name?, endpointUrl?,
  credential? }` (scope `projects:write`, 201) adds one. `kind` is `metric`, `experiment` or
  `estimator`. `serviceKey` is a key the environment defines (`/api/v1/capabilities` → `goalSignals`) or
  `custom`, which needs `endpointUrl` (https, public: the outbound guard refuses a private address) and
  only where `ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS` is on. A service from the environment takes no
  `endpointUrl` or `credential`.
- A connector is `{ id, projectId, kind, serviceKey, name, endpointUrl, hasCredential, state: "ok" |
  "error", lastOkAt, lastError, createdAt }`. **The credential is stored encrypted and never returned.**
- `PATCH …/{connectorId} { name?, endpointUrl?, credential? }` (`credential: null` removes it) and
  `DELETE …/{connectorId}`. Removing a connector leaves a goal bound to it as it was: its reading ages
  into "unknown".
- `POST …/{connectorId}/test { metricKey? }` calls the service once and answers `{ ok, error, reading,
  connector }`; a failed call is a 200 with `ok: false`. The outcome is recorded on the connector.
- **Reading metrics.** A goal's `metric.source { connectorId, metricKey }` is read from a `metric`
  connector by `/api/cron/goal-signals-poll` (every 15 minutes, bounded, stalest connector first) over
  `astrid.metric-source/v1`: `POST {base}/metrics/query`, signed (`X-Astrid-Signature`,
  `X-Astrid-Timestamp`) with the credential as bearer, 10 s and 256 KB, no redirects. A fresh reading is
  written as a measurement with `source: "pull"`; one past `staleAfterHours` (default 48), `no_data` and
  `unknown_metric` write nothing, so the value ages into unknown. 4xx is recorded in `lastError` and not
  retried, 429 waits out `Retry-After`, 5xx and timeouts are retried by the next poll.
- **Metric guardrail check.** An enforced guardrail may carry `check: { type: "metric", source: {
  connectorId, metricKey }, op: "<=" | ">=", threshold, unit?, staleAfterHours? }`. `current` and
  `measuredAt` on it are written by the server and kept across a goals `PUT`. It is violated while the
  fresh reading is outside the threshold, **and while the reading is missing or stale: unknown is never
  passing.** Unlike a policy check it is not about one action, so it holds every merge, deploy and
  migration the project's tasks would make.

### GET|POST `/api/v1/projects/{id}/decisions` and POST `…/decisions/{taskId}/decide`
Decisions as a process (ADEV-180). **A decision is a task**: its description holds the Decision and
the trade-off grid (docs/DECISIONS.md), so it has an id, assignee, lanes and the agent handoff.
Anyone working in the project may use these; an agent may too (it still cannot write the goals).
- `POST { title?, listId?, assigneeId? }` starts one from the project's goals: each goal is a
  criterion column (lettered A, B, C…), every cell starts unrated `~`, a "Do nothing" row is always
  there, and the guardrails are listed under the grid (an option that breaks one is rated `--`).
  `listId` must be in the project (default: its first list). Answers 201 `{ task, criteria }`.
- `GET` answers `{ decisions: [{ id, identifier, title, prompt, options, status: "open"|"decided",
  chosen: { number, text } | null, … }] }`, open first. `chosen` is the `**Decided:** N — text` line
  on the description if there is one, else the latest person's reply that picks an option.
- `POST …/decide { option }` writes that `**Decided:** N — text` line (replacing an earlier one).
- Editing the grid is a client edit of the description: read it with the serialiser pinned by
  `contracts/fixtures/decision-grid.json` (`lib/decision-grid.ts`) and `PUT` the task. Never add a
  score or total column.

---

## Board Art Endpoints

### GET `/api/v1/empathy-art`

The high-fidelity empathy-state frames for empty board columns (ADEV-142, iOS ADEV-127). No
authentication. **Optional for every client:** when the request fails or a frame isn't cached,
show the built-in art. Fetch it while idle, never block a board on it.

```json
{
  "version": 1,
  "revision": "<sha256 over the set>",
  "metaphors": ["race", "wall", "chef", "garden", "hike"],
  "states": ["inbox", "ready", "doing", "waiting", "done"],
  "frames": [{ "metaphor": "race", "state": "inbox", "url": "https://…/images/empathy-art/race-inbox.<hash12>.webp", "sha256": "…", "bytes": 98123 }]
}
```

- One frame per metaphor × state (25): a 1024² transparent WebP of about 100 KB.
- Frame URLs carry their content hash and are served `immutable`; cache them forever. Refetch
  frames only when `revision` changes. The response has `ETag: "<revision>"` and answers `304`
  to a matching `If-None-Match`.
- New metaphors are appended to `metaphors`; a client must use the array it receives, not a
  built-in count, so the rotation stays in step with other clients.

**Which frame a column shows.** A list's metaphor for the day is

```
metaphors[(fnv1a32(utf8(listId)) + floor(epochMs / 86400000)) % metaphors.length]
```

FNV-1a 32-bit (offset `0x811c9dc5`, prime `0x01000193`) over the list id exactly as the server
sends it; the day changes at 00:00 UTC; the sum has no 32-bit wraparound. The column's state:
Done (completed tasks) → `done`; Inbox (`statusRole` null) → `inbox`; `ready`, `doing`, `waiting` →
themselves; any custom column → no frame. Implementation: `lib/empathy-art/rules.ts`; cases every
port must reproduce: `contracts/fixtures/empathy-art.json`.

The art is drawn in [astrid-ios](https://github.com/Graceful-Tools/astrid-ios/tree/main/docs/design/empathy-states/hifi/webp) and copied here with
`npx tsx scripts/import-empathy-art.ts`, which also regenerates `lib/empathy-art/frames.json`.

---

## Comment Endpoints

### GET `/api/tasks/{taskId}/comments`
Get comments for a task.

**Response:**
```json
{
  "comments": [
    {
      "id": "string",
      "content": "string",
      "type": "TEXT",
      "taskId": "string",
      "authorId": "string",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "author": { "id": "string", "name": "string", "email": "string" }
    }
  ]
}
```

### POST `/api/tasks/{taskId}/comments`
Create a comment on a task. Supports file attachments via `fileId`.

**Request:**
```json
{
  "content": "string",
  "type": "TEXT | IMAGE | FILE | CODE | AUDIO | VIDEO",
  "fileId": "string (optional - SecureFile ID to attach)",
  "parentCommentId": "string (optional - for threaded replies)"
}
```

**Notes:**
- `content` is required unless `fileId` is provided
- `fileId` links an existing SecureFile to the comment
- Files can be from the user's uploads or from chat channels the user has access to

For v1 task updates, task comments, and attachment uploads, an MCP access token
bound to an agent attributes the write to that agent. If `aiAgentId` is supplied,
it must match the token's bound agent; an unbound MCP token cannot select one.
Mismatches are rejected with 400.

### POST `/api/v1/tasks/{taskId}/attachment-uploads`
Mint a ticket to upload one image to a task (OAuth/API clients and MCP `create_task_attachment_upload`). Scope `comments:write`; caller must have task access. `taskId` may be an identifier such as `AWTD-1172`.

**Request:**
```json
{
  "fileName": "shot.png",
  "mimeType": "image/png (optional; png | jpeg | gif | webp, derived from extension)",
  "caption": "string (optional, max 1000; default 'Attached: <fileName>')",
  "clientRequestId": "string (optional idempotency key)",
  "aiAgentId": "string (optional; agent author, as on comments)"
}
```

**Response (201):**
```json
{
  "taskId": "uuid", "fileName": "shot.png", "mimeType": "image/png", "clientRequestId": "string",
  "upload": {
    "method": "PUT",
    "url": "https://<host>/api/v1/attachment-uploads",
    "headers": { "X-Upload-Ticket": "<signed ticket>", "Content-Type": "image/png" },
    "expiresAt": "ISO-8601 (15 min)",
    "maxBytes": 4194304
  }
}
```
Errors: 400 (unsupported type incl. SVG, extension/type mismatch, path in name, caption too long, bad `aiAgentId`), 404 (no task access).

### PUT `/api/v1/attachment-uploads`
Upload the raw image bytes with the `upload.headers` above. The ticket is the credential (no OAuth header). Bytes are magic-number checked against the ticket's type; task access is re-checked. Stores a SecureFile and posts an `ATTACHMENT` comment on the task.

- **201** `{ comment, fileId, taskId }`; **200** same payload on a replay of the same ticket/`clientRequestId`
- **401** missing/tampered/expired ticket; **400** empty or non-image body; **404** access revoked; **413** over 4 MB

### PUT `/api/comments/{id}`
Update a comment.

**Request:**
```json
{
  "content": "string"
}
```

### DELETE `/api/comments/{id}`
Delete a comment.

---

## Reminder Endpoints

### GET `/api/reminders/status`
Get pending reminders for the current user.

### PUT `/api/reminders/{id}/dismiss`
Dismiss a reminder.

### PUT `/api/reminders/{id}/snooze`
Snooze a reminder.

**Request:**
```json
{
  "minutes": 15
}
```

---

## User Endpoints

### GET `/api/v1/users/search?q={query}`
Search for users by name or email. Requires the `user:read` scope. The response
also carries `listMemberCount` and a `meta` envelope.

> The legacy `GET /api/users/search` was removed (AWTD-839, 2026-11-14) after
> 28 days with no production traffic. Use this route.

**Query Parameters:**
- `q` (required): Search query (min 2 characters)
- `includeAIAgents` (optional): Include AI agent users
- `taskId` (optional): Filter by task context
- `listIds` (optional): Comma-separated list IDs

**Response:**
```json
{
  "users": [
    {
      "id": "string",
      "name": "string",
      "email": "string",
      "image": "string"
    }
  ]
}
```

### GET `/api/users/{userId}/profile`
Get a user's public profile. The `email` field is returned only when the requester is viewing their own profile; for other users' profiles it is omitted.

---

### GET|PATCH `/api/v1/users/me/smart-tasks`
Task-creation and display preferences. GET requires `user:read`, PATCH requires
`user:write`. PATCH accepts any subset of the fields and returns the updated set;
it also emits `user_settings_updated` to the user's other sessions.

| Field | Type | Notes |
|---|---|---|
| `showListImages` | `boolean \| null` | **Deprecated (AWTD-1387).** The `hide_list_images` experiment is gone and the web app always draws list images. The field is still read and written for shipped iOS/Mac builds: `null` (the value for every user in production) means "no explicit choice", `true`/`false` is one. New clients should ignore it and always draw list images. Any other type → 400. |

The response includes `emailToTaskEnabled`, `defaultTaskDueOffset`,
`defaultDueTime`, `smartTaskCreationEnabled`, `subtaskDisplay` and
`taskDisplayMode`, which follow the same PATCH rules.

---

### GET `/api/v1/users/me/connections`
Everything that can act as the account, from every source, as one list.
Requires `user:read`.

**Response:**
```json
{
  "connections": [
    {
      "id": "string",
      "kind": "oauthClient | authorizedApp | customAgent | accessToken | webhook",
      "name": "string",
      "actsAs": "string | null",
      "scopes": ["string"],
      "createdAt": "ISO 8601",
      "lastUsedAt": "ISO 8601 | null",
      "expiresAt": "ISO 8601 | null",
      "status": "active | expired | disabled",
      "revocable": true,
      "manageIn": "agents | connections",
      "detail": { "clientId": "string", "grantTypes": ["string"], "activeTokens": 1,
                  "permissions": ["string"], "agentId": "string", "webhookUrl": "string" }
    }
  ],
  "meta": { "apiVersion": "v1", "authSource": "session", "total": 1 }
}
```

- `kind` — `oauthClient`: a client the user created; `authorizedApp`: a
  dynamically registered client approved on the consent page (shared across
  accounts; the row is the user's own tokens for it); `customAgent`: a Custom
  Agent the user registered; `accessToken`: a user-level access token;
  `webhook`: the user's webhook server (`id` is the literal `webhook`).
- `actsAs` — the email the credential authors as (an `agent@` mailbox, a
  Custom Agent, or null for the user themself).
- `scopes` — what the API enforces today. `accessToken` rows report `*`.
- `detail` is optional; clients must decode an unknown `kind` as a row they
  cannot revoke, not as a failure.

### DELETE `/api/v1/users/me/connections/{kind}/{id}`
Revoke one connection. **Session-only** (403 for a delegated token): a leaked
credential must not be able to revoke its siblings. `authorizedApp` revokes
only the caller's tokens for that client; `oauthClient` disables the client
and revokes its tokens; `customAgent` deletes the agent (cascading its client
and tokens); `accessToken` deactivates the token; `webhook` removes the
configuration. 400 for an unknown kind, 404 when the row is not the caller's.

**Response:**
```json
{ "success": true, "kind": "authorizedApp", "id": "string", "revokedTokens": 2,
  "meta": { "apiVersion": "v1", "authSource": "session" } }
```

### POST `/api/v1/users/me/access-tokens`
Mint a user-level access token. This is the long-lived bearer the GitHub.com Copilot cloud agent
pastes into its MCP configuration. It's the v1 twin of the web hub's `POST /api/mcp/user-tokens`,
with the same body and the same token (AWTD-1312). Requires `user:write`, and answers 404 where the
deployment has MCP disabled.

It's **session-only**: a delegated token gets a 403, as with client registration and revoke. A
bearer minted from a delegated token would outlive revoking that token. The new token appears in
`GET /api/v1/users/me/connections` as kind `accessToken`, and is revoked there.

**Request:**
```json
{ "permissions": ["read", "write"], "expiresInDays": 90,
  "description": "GitHub Copilot cloud agent", "agent": "copilot" }
```
- `permissions` — one or both of `read`, `write`. Required, and must not be empty.
- `expiresInDays` — 1–365. If omitted, the token never expires.
- `agent` — optional. It's an agent mailbox from the consent screen's roster, and comments made
  with the token are authored as that agent rather than as the user.
- `scopes` — optional (AWTD-1567). OAuth scope names from the same set an OAuth client can hold,
  for example `["tasks:read", "lists:read"]`. If omitted, the token is **unscoped** and granted
  `*`, like every token minted before this field existed. If given, the scopes are stored on the
  token and the token is held to them under `ASTRID_TOKEN_SCOPE_ENFORCEMENT` (see *Access-token
  scope enforcement* below). `*`, an unknown name or an empty list is a 400 that names the
  refused entry. Nothing is dropped silently.

**Response:**
```json
{ "success": true, "token": "astrid_mcp_…", "permissions": ["read", "write"],
  "scopes": ["tasks:read", "lists:read"] | null,
  "expiresAt": "ISO 8601 | null", "description": "string | null", "createdAt": "ISO 8601",
  "meta": { "apiVersion": "v1", "authSource": "session" } }
```
Errors: 400 for an invalid body or a scope a token cannot hold, 403 when MCP access is disabled
for the account, 409 when the requested agent identity cannot be resolved.

### POST `/api/v1/users/me/access-tokens/:id/rotate`
Replace an access token's secret (AWTD-1567). The new token has the old one's `permissions`,
`scopes` (or none), agent binding and description. A token with an expiry gets the same
lifetime again, counted from now. The old token is revoked in the same transaction. The plaintext
appears only in this response. It requires `user:write` and is **session-only**: a token cannot
rotate itself. Settings → Connections offers it as **Rotate** on every active access token.

**Response:** the mint response plus `"id"` (the new `MCPToken.id`) and `"replacedId"`.
Errors: 403 for a non-session caller or when MCP access is disabled, 404 when the token is not
the caller's, is already revoked, or is list-level.

### Access-token scope enforcement (AWTD-1567)
An access token minted with `scopes` is limited to them once the flag covers its owner:

| `ASTRID_TOKEN_SCOPE_ENFORCEMENT` | Effect |
|---|---|
| unset, `off`, anything else | Nobody is enforced (the default). Scoped tokens keep `*`, and their own scopes are the `shadowScopes` the would-deny log measures. |
| `canary` | Only tokens whose owner's user id is in `ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS` (comma-separated). |
| `on` | Every token minted with `scopes`. |

**Unscoped tokens are never enforced**, whatever the flag says. That includes every token minted
before AWTD-1567, because its `scope` column is null. To roll back, set the flag to `off`.

**Canary procedure.** First, mint a scoped token on the canary account. Do this signed in, from
the browser, with a `POST /api/v1/users/me/access-tokens` that carries `scopes`; the Copilot setup
card still mints unscoped tokens. Then set `ASTRID_TOKEN_SCOPE_ENFORCEMENT=canary` and
`ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS=<that user id>` and redeploy: environment variables are
read at deploy time. Use the token on `/api/v1` and `/mcp`. Its Connections row should say it is
limited to its scopes. A call outside them should return the 403 below, and the other accounts'
tokens should be unchanged. Widen to `on` only after that.

An enforced token is refused wherever a route declares scopes (`withAuth` `scopes`/`anyOfScopes`,
or `requireScopes`), exactly as an OAuth token with the same scopes would be. The 403 names what
was missing:
```json
{ "error": "Forbidden", "message": "Missing required scopes: tasks:write",
  "missingScopes": ["tasks:write"], "tokenScopes": ["tasks:read", "lists:read"],
  "hint": "This access token was minted with explicit scopes…" }
```
Limits:
- A route that declares no scope (`none` or `handler-auth` in
  `tests/fixtures/route-scope-inventory.json`) accepts any authenticated caller, which is also true
  of OAuth tokens. Scope enforcement does not add a check to such a route. List and task permissions
  still apply.
- **`/mcp`**: each tool call is an `/api/v1` request carrying the same token, so it meets the same
  gate. The tool result carries the 403 message (`Forbidden: Missing required scopes: …`).
  Connecting and `tools/list` are not gated by scope.
- **`/api/mcp/operations`** checks no scopes, so an enforced token gets a 403 there and must use
  `/api/v1` or `/mcp`.
- `GET /api/v1/users/me/connections` lists a scoped token with its own `scopes` and
  `detail.scoped: true`. `detail.scopeEnforced` says whether the flag holds it to them now. An
  unscoped token shows `["*"]`.

### AI service ids
`serviceId` in `PUT|DELETE /api/v1/users/me/ai-credentials` and
`POST /api/v1/users/me/ai-credentials/test`, the keys of
`GET|PUT /api/v1/users/me/ai-model-preferences`, `?service=` on
`GET /api/v1/users/me/available-models`, and `preferredService` in
`/api/v1/users/me/ai-preferences` all take one of the following values:

| Value | Provider | Default model |
|---|---|---|
| `claude` | Anthropic | `claude-sonnet-4-6` |
| `openai` | OpenAI | `gpt-4o` |
| `gemini` | Google | `gemini-2.5-flash` |
| `copilot` | GitHub Copilot (GitHub OAuth or a pasted token) | `gpt-4.1` |
| `muse` | Meta Model API (`https://api.meta.ai/v1`), using a key from the Meta Developer Console. Added by AWTD-1053. | `muse-spark-1.3` |
| `openclaw` | Custom Agent (credentials only, no model) | — |

`muse@` is one identity with two runtimes, like `claude@`. In `polling` mode
the Muse Code CLI works its queue. In `api` mode the server runs it on the
user's Meta key. `available-agents` returns `{ "service": "muse", "name": "Muse" }`
for it under the same rules as every other built-in. Clients must treat an
unknown service value as a provider they cannot configure, not as an error.

---

## Account Endpoints

> The legacy `/api/account` routes are gone: `/api/account/delete`,
> `/verify-email` and `/export` were removed in AWTD-839 (2026-10-28), and
> `GET|PUT /api/account` followed on 2026-11-14 after 28 days with no
> production traffic. Their successors are below.

### GET `/api/v1/users/me`
Get current user's account details, as `{ "user": { ... }, "meta": { ... } }`.
`user` includes the email verification status. Scope: `user:read`.

### PUT `/api/v1/users/me`
Update account settings. Scope: `user:write`. Changing `email` sends a
verification email and returns `emailVerificationRequired: true`. The default
due time has its own route, `/api/v1/users/me/default-due-time`.

**Request:**
```json
{
  "name": "string",
  "email": "string",
  "image": "string"
}
```

### POST `/api/v1/users/me/verify-email?action={action}`
Manage email verification.

**Actions:** `send`, `resend`, `cancel`

### POST `/api/v1/users/me/delete`
Delete the user's account.

**Request:**
```json
{
  "confirmationText": "DELETE MY ACCOUNT"
}
```

### GET `/api/v1/users/me/export?format={format}`
Export account data.

**Formats:** `json`, `csv`

### GET `/api/v1/runtime-bindings/{id}/audit-export?format={format}`
Export one runtime binding's audit trail (AWTD-1670, RFC §7). Deployment
administrators only, with a full-access credential (a browser session); an
OAuth token scoped to tasks or lists gets 403. A download, not an envelope.

**Formats:** `json` (default), `csv`

Writes an `audit-exported` event before reading, and refuses (500) if it cannot.
Each event carries its `retentionClass` (`operational` or `lifecycle`); detail
keys that name a secret are redacted. Headers: `X-Audit-Event-Id` (the export's
own event), `X-Audit-Export-Truncated` (more than 50,000 events). 404 for an
unknown binding, 400 for another format.

---

## App Release Endpoints

### GET `/api/v1/app-version`
What version of the iOS or Mac app is released on the App Store, for the
in-app Update card (AWTD-920, iOS AITD-383).

**Query parameters:**

| Name | Required | Values |
|------|----------|--------|
| `platform` | yes | `ios`, `mac` |

`platform` is required and never inferred. The two apps version independently,
so answering the wrong one's number would prompt whichever app is behind the
other to "update" on every launch.

**Response:**
```json
{
  "latestVersion": "1.9.2",
  "minimumVersion": "1.5.0",
  "updateUrl": "https://apps.apple.com/app/id123456789",
  "releaseNotes": "..."
}
```

Every field is optional and absent fields are **omitted rather than null**, so
`{}` is a valid response meaning "no update known". Two fields are
load-bearing on the client:

- **`latestVersion`** — nothing happens without it. The client prompts only
  when this is *strictly* newer than the running build, compared component-wise
  and numerically, so `1.10.0` is newer than `1.9.2`. Internal TestFlight
  builds routinely run ahead of the store, and anything looser would tell a
  tester to downgrade.
- **`updateUrl`** — **no `updateUrl`, no card**, even when `latestVersion` is
  newer: the client will not offer an update it cannot send the user to. Only
  `https`, `http`, `macappstore` and `itms-apps` are accepted, on both sides —
  the value ends up in `openURL`. The server drops a URL with any other scheme
  rather than serving it, so a bad value degrades to "no update known" instead
  of a card with a dead button.

The client checks once per launch, never polls, and remembers dismissal per
version.

**Errors:** `400` for a missing or unrecognised `platform` — never another
platform's answer. `401` if unauthenticated.

**Source of truth:** the hand-maintained table in `lib/app-version.ts`, which
a release updates. It is **empty by default**, which is the safe state: the
clients treat any failure or empty response as "no update known" and show
nothing, so the endpoint is inert until someone fills in a real store version
and a verified `updateUrl`.

---

## File Upload

### POST `/api/upload`
Upload a file (multipart/form-data).

**Request:** Multipart form with `file` field.

**Response:**
```json
{
  "url": "string",
  "filename": "string"
}
```

### POST `/api/v1/secure-upload/get-upload-url`: direct upload of a large file
Body: `{ fileName, fileType, fileSize, context: { taskId? | listId? | commentId?, clientRequestId? } }`.

**Response:** `{ fileId, pathname, presigned: { uploadUrl, headers } }`. A server whose storage
cannot take direct uploads answers `500 { error: "Storage not configured" }`.

PUT the bytes to `presigned.uploadUrl` with `presigned.headers` as given, plus
`Content-Type`, and no `Authorization` header. Do not assume where that URL points:
- On Vercel Blob it is Blob's host, and Blob calls the server back once the upload lands.
- On a self-hosted deployment (`STORAGE_DRIVER=s3|local`) it is the server's own
  `/api/v1/storage/uploads/<grant>`, `headers` is `{}`, and the file is recorded before
  the PUT returns.

Either way the PUT answers `{ url, pathname, contentType }`, and `fileId` is the
attachment. The legacy Vercel Blob pair (`uploadToken`/`uploadUrl`) was removed with the
Blob store's OIDC upgrade (AWTD-1386), so iOS builds before 1253 and Mac builds before
1254 can no longer upload. The self-hosted path is in
[deployment/SELF_HOSTING.md](./deployment/SELF_HOSTING.md), *How uploads work off Vercel*.

---

## Chat Endpoints

See [iOS Chat API Spec](ios/IOS_CHAT_API_SPEC.md) for full details.

### POST `/api/chat/channels`
Get or create a chat channel for a list or virtual key (My Tasks).

### GET `/api/chat/channels/{channelId}/messages`
Paginated messages. Query: `limit`, `before` (cursor).

### POST `/api/chat/channels/{channelId}/messages`
Send a message. Body: `{ content, type?, fileId?, replyToId?, clientRequestId? }`

---

## Real-Time Updates

### GET `/api/sse`
Server-Sent Events endpoint for real-time updates.

Every event is an unnamed SSE message (read it in `onmessage`, not `addEventListener`) whose
body is `{ "type": "<event>", "timestamp": "<ISO 8601>", "data": { … } }` (`connected` and
`ping` carry no `data`). Switch on `type`.

**Events** — names are snake_case, exactly as below. The canonical list is
`lib/sse-event-types.ts`; the server cannot send a type missing from it, and
`tests/rules/sse-event-names-match-the-contract.test.ts` fails if this list drifts from it.
(This list once read `task:created`, `comment:created`, … — names the server never sent.)

Connection:
- `connected` - Stream opened
- `ping` - Keep-alive heartbeat
- `reconnect` - Server is closing the stream; reconnect with `since` to recover missed events

Tasks:
- `task_created` - New task created
- `task_updated` - Task modified
- `task_completed` - Task modified, and the change completed it (sent instead of `task_updated`)
- `task_deleted` - Task removed
- `task_assigned` - Task assigned to the recipient

Comments:
- `comment_created` - New comment added
- `comment_updated` - Comment edited
- `comment_deleted` - Comment removed

Lists and membership:
- `list_created` - New list created
- `list_updated` - List modified
- `list_deleted` - List removed
- `list_member_added` - Member added to a list
- `list_member_removed` - Member removed from a list
- `list_member_role_changed` - Member role changed (to anything but admin)
- `list_admin_role_granted` - Member promoted to admin

Chat:
- `chat_message_created` - New chat message
- `chat_message_updated` - Chat message edited
- `chat_message_deleted` - Chat message removed
- `chat_mention` - Recipient was @-mentioned in a chat message

AI agents:
- `agent_typing_start` - AI agent began processing (show typing indicator)
- `agent_typing_stop` - AI agent finished processing (hide typing indicator)
- `agent_task_start` - A scheduled agent task has started
- `agent_task_comment` - A comment on a task assigned to an agent
- `ai_agent_assigned` - An AI agent was assigned a task
- `ai_agent_activity` - Activity reported by an external AI agent webhook

User and app state:
- `my_tasks_preferences_updated` - My Tasks filter/sort preferences changed
- `user_settings_updated` - User settings changed
- `feature_flags_updated` - Feature flags changed; refetch them
- `external_sync_refresh` - An external source (e.g. GitHub issues) changed; refetch the affected list

---

## Data Types

### Task Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| title | string | yes | |
| description | string | yes | Can be empty |
| completed | boolean | yes | |
| isPrivate | boolean | yes | |
| repeating | enum | yes | `never`, `daily`, `weekly`, `monthly`, `yearly`, `custom` |
| repeatFrom | enum | yes | `DUE_DATE`, `COMPLETION_DATE` |
| occurrenceCount | number | yes | |
| priority | enum | yes | 0, 1, 2, 3 |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |
| creatorId | string | yes | |
| assigneeId | string | no | |
| dueDateTime | date | no | ISO 8601 |
| isAllDay | boolean | no | |
| lists | array | no | List references |

### TaskList Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| name | string | yes | |
| privacy | enum | yes | `PRIVATE`, `SHARED`, `PUBLIC` |
| ownerId | string | yes | |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |
| color | string | no | Hex color code |
| imageUrl | string | no | |
| description | string | no | |

### User Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| email | string | own profile only | Returned only when viewing your own profile; omitted for other users |
| name | string | no | |
| image | string | no | Avatar URL |

### Comment Fields (V1)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | string | yes | UUID |
| content | string | yes | |
| type | enum | yes | `TEXT`, `MARKDOWN`, `ATTACHMENT` |
| taskId | string | yes | |
| authorId | string | no | |
| createdAt | date | yes | ISO 8601 |
| updatedAt | date | yes | ISO 8601 |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Not authenticated |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

### Hosted MCP authentication challenges

`/mcp` validates bearer credentials before initialization, tool discovery, or
dispatch. It speaks Streamable HTTP only: POST a JSON-RPC message and read the
reply from the response body; an authenticated GET opens the optional listen
stream, which stays open and sends no events. The legacy SSE transport and its
`/mcp/messages` URL were retired in AWTD-1569.
OAuth and legacy MCP bearer tokens remain supported, as do Basic client
credentials and the existing `X-Astrid-*` headers. Browser sessions cannot
substitute for an invalid hosted bearer.

Rejected bearer credentials return HTTP 401 with:

```http
WWW-Authenticate: Bearer resource_metadata="https://www.astrid.cc/.well-known/oauth-protected-resource/mcp", error="invalid_token"
```

On `/mcp` the metadata URL is the deployment's `NEXTAUTH_URL` origin,
falling back to the request's Host only when that is unset, so a proxy's `localhost` Host is
never advertised (ADEV-99); `/api/mcp/operations` uses the request origin. Missing credentials receive the same
discovery challenge without `error="invalid_token"`. `/api/mcp/operations` also
includes discovery in its existing HTTP 401 challenge. Backend authentication
failures remain HTTP 500, not invalid-token challenges; authenticated task/scope
denials remain authorization failures, not requests to sign in again.

The proxy validates against the same effective backend selected by
`X-Astrid-API-Base-URL` or `ASTRID_API_BASE_URL`, not a different deployment's
database. Remote backends must support `GET /api/v1/oauth/validate`: token-only,
no scope requirement, no cookie fallback, HTTP 204 with an empty body for a valid
OAuth/legacy bearer, HTTP 401 for rejection, HTTP 500 for backend failure.
Validation never follows redirects or returns token/account metadata.

Hosted backend overrides require public HTTPS without URL credentials, query,
or fragment. Every outbound validation, token exchange, and API request rejects
redirects and pins its checked DNS address. Only an exact operator-configured
`ASTRID_API_BASE_URL` may use private addresses or HTTP; request Host/Origin does
not grant an exception. Unsafe overrides return HTTP 400, not `invalid_token`.
Hosted backend responses are limited to 16 MiB and requests time out after 30 seconds.

---

## Rate Limiting

- Standard endpoints: 100 requests/minute
- Search endpoints: 30 requests/minute
- File upload: 10 requests/minute

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

---

## Changelog

### v1 (Current)
- Initial stable API release
- All endpoints documented above
- Added `GET /api/v1/app-version` for the iOS/Mac Update card (AWTD-920)
- Added the `muse` AI service id (Meta Model API). `muse@` can now be server-run (AWTD-1053)
- Added `serverTime` to `GET /api/v1/tasks` and `GET /api/v1/lists`, and keyset paging
  (`?cursor=` → `nextCursor`) to `GET /api/v1/tasks`. Additive (AWTD-1470)
- Added the claim lease (`claimHolderId`, `claimLeaseExpiresAt`, `claimHeartbeatAt`) to each
  row of `GET /api/v1/tasks`; `GET /api/v1/tasks/{id}` already carried it. Additive. The claim
  heartbeat reads the board from this list and, without the fields, never renewed a lease (ADEV-310)
- `GET /api/v1/agent-queue` can answer `mode: "off"` with no work for a polling-only agent the
  caller turned Off, when the server sets `ASTRID_AGENT_EXECUTION_MODE_HONOR_OFF=true` (AWTD-1563)
