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
`queue` and conversations in `attention`. An optional `attention.tasks[].resume`
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
| `listId` | only this list's tasks; caller must have access to it |
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

### GET `/api/users/search?q={query}`
Search for users by name or email.

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

**Response:**
```json
{ "success": true, "token": "astrid_mcp_…", "permissions": ["read", "write"],
  "expiresAt": "ISO 8601 | null", "description": "string | null", "createdAt": "ISO 8601",
  "meta": { "apiVersion": "v1", "authSource": "session" } }
```
Errors: 400 for an invalid body, 403 when MCP access is disabled for the account, 409 when the
requested agent identity cannot be resolved.

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

### GET `/api/account`
Get current user's account details.

### PUT `/api/account`
Update account settings.

**Request:**
```json
{
  "name": "string",
  "image": "string",
  "defaultDueTime": "09:00"
}
```

### POST `/api/account/verify-email?action={action}`
Manage email verification.

**Actions:** `send`, `resend`, `cancel`

### POST `/api/account/delete`
Delete the user's account.

**Request:**
```json
{
  "confirmationText": "delete my account"
}
```

### GET `/api/account/export?format={format}`
Export account data.

**Formats:** `json`, `csv`

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
dispatch; `/mcp/messages` revalidates them before an SSE message is dispatched.
OAuth and legacy MCP bearer tokens remain supported, as do Basic client
credentials and the existing `X-Astrid-*` headers. Browser sessions cannot
substitute for an invalid hosted bearer.

Rejected bearer credentials return HTTP 401 with:

```http
WWW-Authenticate: Bearer resource_metadata="https://www.astrid.cc/.well-known/oauth-protected-resource/mcp", error="invalid_token"
```

The metadata URL follows the requested host. Missing credentials receive the same
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
SSE messages must match the retained stream's effective credential and backend;
the retained options, not an independently selected POST credential, are revalidated.

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
