# Spec: Astrid as a white-label client for GitHub Projects

*Architecture review and spec of record for running Astrid's apps on top of GitHub
Projects (v2). Written 2026-10-04.*

Status: **Proposal — not implemented.** The decisions below still need sign-off. They
are listed in §11.

Companions:
- [WHITELABELING.md](../WHITELABELING.md) covers brand identity and capabilities. This
  spec adds one backend capability to that system and introduces nothing parallel to it.
- [PROJECT_MODE.md](../product/PROJECT_MODE.md) covers boards and statuses. §6.4 proposes
  one amendment to it.
- [TASK_IDENTIFIERS.md](./TASK_IDENTIFIERS.md) and
  [TASK_BLOCKING_DEPENDENCIES.md](./TASK_BLOCKING_DEPENDENCIES.md) are the models GitHub
  identifiers, sub-issues and dependencies map onto.

---

## 0. The ask, and the answer in one paragraph

> *"Do a full architecture review between the current Astrid project and GitHub
> projects. What would we need to do to make Astrid white label the app for GitHub
> projects? Define the spec to support."*

Astrid's front ends (web, iOS/Mac, Windows) can become a branded client for GitHub
Projects without rewriting the clients and without making GitHub the database the
clients talk to. The design has five parts:

1. **GitHub owns the shared data.** For a list bound to a GitHub Project, GitHub is
   authoritative for its items and their fields.
2. **Postgres is a replica of it.** Astrid keeps a write-through replica, and every read
   path (v1 API, delta sync, SSE, offline, permissions) keeps working against that
   replica unchanged.
3. **Writes go to GitHub first.** Each write goes to GitHub under the acting user's own
   GitHub identity and lands in the replica only once GitHub accepts it.
4. **Inbound changes arrive by webhook.** Changes made in GitHub reach the replica
   through GitHub App webhooks, backed by a periodic reconciliation pass.
5. **The brand chooses where it applies.** A white-label deployment makes this backend
   mandatory. Astrid itself can offer the same machinery as an opt-in list type.

Most of the work is in the seam (§5), auth consolidation (§7) and the sync engine (§8).
Very little is in the UI.

---

## 1. Architecture review: where Astrid stands today

### 1.1 What already helps

| Asset | Where | Why it matters here |
|---|---|---|
| Build-time brand and capability system | `lib/brand/{config,capabilities,copy}.ts`, `brands/*.brand.json`, brand matrix test | Gives a white-label deployment a home. Disabled capabilities already 404 server-side. |
| External-link tables | `Integration`, `ExternalListLink`, `ExternalTaskLink` (`prisma/schema.prisma` ~L1378–1487) | A list-to-remote-container and task-to-remote-item mapping with cursors and watermarks already exists. |
| Server sync engine for GitHub Issues | `lib/sync/github/{sync-all-links,pull-issues,apply-issues,push-tasks}.ts`, `app/api/cron/github-sync` | Pull/apply/push is already split out, and the cursor is committed only after apply. |
| GitHub App plus Octokit installation tokens | `lib/github-client.ts`, `GitHubIntegration` model, `app/api/github/webhooks` | The HMAC-verified webhook endpoint and installation-token minting can be reused. |
| Write orchestration in one place | `services/task.service.ts` (`create/update/deleteTaskWithSideEffects`) | The natural place to add a backend seam. Side effects are already centralised. |
| Status is a task field | `Task.statusRole` + `Project.customStates` (AWTD-562) | Maps one-to-one onto a Projects single-select **Status** field. |
| Subtasks, dependencies, closed reason | `parentTaskId`, `TaskDependency`, `closedReason` | GitHub sub-issues, issue dependencies and `state_reason` map onto these. |
| "A cycle is a virtual list with a date window" | PROJECT_MODE.md §1 | Exactly what a Projects **Iteration** field is. |
| Additive-only v1 contract and a capabilities endpoint | `docs/API_CONTRACT.md`, `GET /api/v1/capabilities` | Clients can learn per list what a GitHub-backed list supports, without breaking changes. |

### 1.2 What is missing or in the way

| # | Gap | Evidence |
|---|---|---|
| G1 | **No Projects v2 code at all.** No ProjectV2 node ids, item ids, field ids or option ids anywhere. The only GraphQL call is sub-issue parent lookup. | `lib/sync/github.ts:150`, `pull-issues.ts:123–149` |
| G2 | **Three unrelated GitHub credentials.** Issues sync uses an OAuth app with `repo` scope (`GITHUB_SYNC_*`). The coding agent uses a GitHub App (`GITHUB_APP_*`). Copilot uses a third OAuth client. None has `project` permissions. | `integrations/github/authorize/route.ts:32`, `lib/github-client.ts:70`, `lib/copilot/oauth` |
| G3 | **No sign-in with GitHub.** NextAuth registers Google, Apple and passkeys only. `GITHUB_CLIENT_ID` in `.env.example` is dead. | `lib/auth-config.ts:143–163` |
| G4 | **The sync container is a repo, not a project.** `remoteContainerId = "owner/repo"`, validated as such. PRs are filtered out. | `pull-issues.ts:100`, `isValidRepoId` |
| G5 | **Conflicts are last-writer-wins by timestamp, and Astrid wins inside a pass** because push runs before pull. That is the wrong polarity if GitHub is authoritative. | `sync-all-links.ts:122–140`, `push-tasks.ts:186` |
| G6 | **Webhooks only nudge, and need manual setup per repo.** `issues` and `issue_comment` only, no `projects_v2_item`. Projects v2 webhooks exist **only** for org webhooks and GitHub Apps. | `app/api/webhooks/github-issues/route.ts` |
| G7 | **No rate-limit handling.** No `retry-after` or `x-ratelimit-*` handling, no GraphQL point budgeting, no timeout on `githubGraphQL`. | `lib/sync/github.ts:150` |
| G8 | **No durable job queue.** The cron is limited to 15 minutes, 25 links and 60s. A webhook-driven design needs retryable work. | `vercel.json`, `sync-all-links.ts:36,87` |
| G9 | **Two divergent sync engines.** iOS runs full Issues sync in Swift. The server runs a create/update-only subset. There is no provider interface. | `lib/sync/github.ts:9`, `lib/sync/google.ts:5` |
| G10 | **Prisma is called from everywhere.** 31 `app/api` files contain `prisma.task.`. About 118 files across `app/api`, `lib` and `services` touch tasks, lists, members or comments. MCP handlers (~2.7k lines) are Prisma-direct. | grep, `app/api/mcp/operations/handlers/*` |
| G11 | **Single assignee.** GitHub issues have up to 10 assignees. | `Task.assigneeId` |
| G12 | **No tenancy.** Everything is scoped by user, list and project. A SaaS serving many GitHub orgs needs an installation boundary. | schema, `WORKSPACE_INVITE` unused |
| G13 | **Custom fields are banned by product policy**, and GitHub Projects' core idea is custom fields. | PROJECT_MODE.md:146 |
| G14 | **The coding-agent webhook is gated on `syncGithubIssues`**, not on a coding capability. Today's coupling bug, and in the way of consolidation. | `app/api/github/webhooks/route.ts:399` |
| G15 | **Labels and milestones are pulled and dropped. Parent and assignee are applied on create only.** Comments are never synced server-side. | `pull-issues.ts:117`, `apply-issues.ts:192` |

### 1.3 The decision this review forces

There are three possible shapes. This spec picks **B**.

| | Shape | Verdict |
|---|---|---|
| A | **GitHub is the database.** Rewrite every read and write to call GitHub directly. | **Rejected.** It breaks the ten load-bearing assumptions in §1.4: permission joins, delta sync, `DeletionLog`, SSE audience, offline idempotency, client-side filtering over a full fetch, transactional side effects, agents as users, MCP, and fields GitHub lacks. Months of rewrite, plus a client that hits GraphQL rate limits on every launch. |
| **B** | **Remote-authoritative replica.** GitHub is the source of truth for bound lists. Postgres is a write-through replica plus a home for Astrid-only fields. Clients are unchanged. | **Chosen.** Reuses the v1 API, SSE, offline, delta sync and the iOS outbox as they are. The new code sits behind one seam and one sync engine. |
| C | **Extend today's bidirectional sync.** Postgres stays authoritative and syncs both ways with Projects. | **Rejected.** Two writers with timestamp last-writer-wins (G5) gives exactly the silent-overwrite bugs a "GitHub Projects app" cannot have. When users can also edit in github.com, the product is only trustworthy if GitHub wins. |

### 1.4 Why Shape A breaks things

These are the places that assume tasks live in Postgres. Shape B leaves every one of them
intact because the replica is still Postgres.

1. Permission SQL joins: `lib/list-permissions.ts:187–213`, `TASK_FULL_INCLUDE`.
2. Many-to-many `Task.lists`.
3. Transactional side effects in `*WithSideEffects`: TaskEvents, notifications,
   reminders, SSE, webhooks.
4. Delta sync: `?updatedSince=` plus `DeletionLog`.
5. The SSE audience is computed from list members (about 30 call sites).
6. Identifiers and the board model.
7. Clients fetch everything and filter locally (`applyVirtualListFilter`).
8. Offline outbox idempotency via a unique `clientRequestId`.
9. Fields GitHub has no slot for: recurrence, reminders, private, cost, timers.
10. Agents are User rows: agent queue, MCP token scoping.

---

## 2. Goals and non-goals

### Goals

1. **A partner deploys "\<Brand\> for GitHub Projects".** It uses an existing brand
   profile plus one backend setting. Users sign in with GitHub, pick org projects, and
   work in Astrid's web, iOS and Mac clients.
2. **Edits made in github.com show up in Astrid.** Every edit made there is reflected in
   Astrid within seconds by webhook, and within one reconciliation interval at worst.
3. **Edits made in Astrid show up in GitHub immediately**, attributed to the acting
   GitHub user, and respecting that user's GitHub permissions.
4. **The Astrid build does not change.** A build that sets nothing behaves exactly as
   today. The brand matrix keeps enforcing that.
5. **The same machinery can ship on astrid.cc** as an opt-in "GitHub Project board" list
   type, replacing the Issues sync over time.

### Non-goals for v1

- **User-owned projects.** GitHub sends no Projects webhooks for them. They are polling
  only, and deferred to v2 (§11 Q3).
- **Mirroring Projects views** (table, roadmap, saved filters, group-by). v1 mirrors the
  board grouped by Status. Views become virtual lists in v2.
- **Creating or editing a project's field schema from Astrid.** Fields are managed in
  GitHub.
- **Recurring tasks on GitHub-backed lists.** A recurrence would mint a new issue on
  every completion. This needs its own decision (§6.6).
- **GitHub Enterprise Server.** The API base URL is made configurable (§7.5), but GHES
  is not tested in v1.
- **Replacing Copilot's OAuth credential.** It does a different job (§7.4).

---

## 3. Concept map

| GitHub | Astrid | Notes |
|---|---|---|
| GitHub App installation on an org | **`GitHubWorkspace`** (new) | The tenancy boundary for one deployment serving many orgs (§4.1). |
| `ProjectV2` (org-owned) | `Project` (board) plus its primary `TaskList` | `Project.key` stays **null**. Identifiers come from GitHub (§6.3). |
| `ProjectV2Item` | Membership of a `Task` in that list | Keyed by item node id (`PVTI_…`). |
| Item content: `Issue` | `Task` | Keyed by **issue node id** (`I_…`), which is stable across transfers, unlike `owner/repo#N`. |
| Item content: `DraftIssue` | `Task` | Has no repo, number, comments, labels or assignees beyond the draft's own. Can be converted to an issue. |
| Item content: `PullRequest` | `Task`, read-only content | Status and fields are editable. Title and body are read-only in v1. |
| An issue in N projects | One `Task` in N lists | Astrid's many-to-many `Task.lists` fits naturally. |
| **Status** field (single-select) | `Task.statusRole` + `Project.customStates` | Map by option id (§6.2). |
| "Done" option, or `state: closed` | `Task.completed` + `closedReason` | `state_reason` maps to `closedReason` through `lib/closed-reason.ts`. |
| Iteration field | Virtual list with a date window (PROJECT_MODE's "cycle") | Read-only in v1. |
| Designated single-select **Priority** field | `Task.priority` 0–3 | Map by option order (§6.2). |
| Designated **Date** field (e.g. "Due", "Target") | `Task.dueDateTime`, `isAllDay = true` | |
| Number field "Estimate" | `Task.estimate` | Already a nullable Project Mode column. |
| Any other field | Read-only **GitHub fields** panel | Stored in `remoteFields` JSON (§6.4). |
| Labels (repo-scoped) | Label-flavor lists (`listType: 'label'`) inside the workspace | One list per `(repo, label)`, shown as `label`, with the repo shown when ambiguous. |
| Milestone | Read-only chip plus a virtual list | |
| Assignees (≤10) | `assigneeId` (primary) + new `assigneeIds[]` | Additive API field (§6.5). |
| Sub-issues | `parentTaskId` | |
| Issue dependencies (blocked by / blocking) | `TaskDependency` | Inbound cycles are accepted from GitHub. The Astrid-side 409 check applies only to Astrid writes. |
| Issue comments | `Comment` | Drafts have none, so the comment box is disabled with an explanation. |
| Item position | `TaskList.manualSortOrder` | Write via `updateProjectV2ItemPosition`. |
| Project collaborators, org and repo permissions | `ListMember` rows with derived roles | Materialised, never edited in Astrid (§7.3). |
| GitHub user | `User` linked by **numeric GitHub id**, never by login | Logins are renameable. |
| GitHub App bot | Astrid's AI-agent User rows | Agent writes are made as the App and labelled in the comment body (§7.2). |

---

## 4. Data model changes

All changes are **additive and nullable**. A build that never binds a GitHub project
writes no rows to any of them. This is PROJECT_MODE's "nullable columns render nothing".

### 4.1 New tables

```prisma
/// One GitHub App installation (an org) this deployment serves. The tenancy
/// boundary for GitHub-backed data: every bound Project carries one.
model GitHubWorkspace {
  id              String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  installationId  BigInt   @unique
  accountNodeId   String   @unique   // O_… org node id; stable across renames
  accountLogin    String             // display only; refreshed from webhooks
  suspendedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  projects        Project[]
}

/// Per-project mapping of GitHub field and option ids onto Astrid semantics.
/// Written by the bind wizard and refreshed on `projects_v2` edits.
model GitHubProjectBinding {
  projectId        String  @id            // Astrid Project
  projectNodeId    String  @unique        // PVT_…
  number           Int
  statusFieldId    String?
  statusOptionMap  Json     // { optionId: statusRole | "done" }
  priorityFieldId  String?
  priorityOptionMap Json?   // { optionId: 0..3 }
  dueFieldId       String?
  estimateFieldId  String?
  iterationFieldId String?
  defaultRepoNodeId String? // where "New task" creates a real issue; null = draft
  fieldSchema      Json     // snapshot of all fields, for the read-only panel
  lastReconciledAt DateTime?
  reconcileCursor  String?
}

/// Durable, idempotent sync work. Drained inline (waitUntil) and by a
/// per-minute cron, so a lost function never loses an event (G8).
model GitHubSyncJob {
  id          String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  dedupeKey   String   @unique   // X-GitHub-Delivery, or "reconcile:<project>:<window>"
  kind        String             // webhook | reconcile | writeback-retry | membership
  payload     Json
  workspaceId String
  attempts    Int      @default(0)
  runAfter    DateTime @default(now())
  lockedUntil DateTime?
  doneAt      DateTime?
  error       String?
  @@index([doneAt, runAfter])
}
```

### 4.2 Columns on existing tables

| Table | Column | Purpose |
|---|---|---|
| `Project` | `githubWorkspaceId String?` | Null means a classic Astrid project. |
| `TaskList` | `backend String? // null \| "github_project"` | The single switch every write path consults (§5). |
| `Task` | `remoteNodeId String? @unique` | Issue, draft or PR content node id. |
| `Task` | `remoteKind String?` | `issue \| draft \| pull_request` |
| `Task` | `remoteFields Json?` | Read-only snapshot of custom field values (§6.4). |
| `Task` | `remoteVersion String?` | The content's `updatedAt` as last applied. Used only as a hint; apply compares values (§8.4). |
| `Task` | `assigneeIds String[]` | Additional assignees (§6.5). |
| `User` | `githubUserId BigInt? @unique` | The identity link. Never the login. |
| `ExternalTaskLink` | *(unchanged)* | Stays for Issues and Google sync. GitHub Project items use the item table below. |

```prisma
/// A task's membership in one GitHub Project (an issue can be in many).
model GitHubProjectItem {
  itemNodeId String  @id          // PVTI_…
  projectId  String               // Astrid Project
  taskId     String
  archived   Boolean @default(false)
  @@unique([projectId, taskId])
}
```

### 4.3 What does not change

- `Task.identifier` keeps its unique index. For GitHub-backed tasks it holds
  `owner/repo#N` (§6.3), which is globally unique by construction. Drafts store null.
- `Project.key` is already nullable, so GitHub-backed projects leave it null. Nothing is
  minted and `nextSequence` is untouched. That means **no** key-collision problem across
  orgs, and no tenancy migration on the existing unique index.
- `ListMember`, `TaskEvent`, `Notification`, `DeletionLog` and `Comment` are reused as
  they are.

---

## 5. The seam: one backend switch on writes

### 5.1 Rule

> **Every mutation of a task, comment, membership or list field on a list whose
> `backend` is non-null goes through `TaskBackend`. Nothing else may write those rows.**

Pinned by a new rule test, `tests/rules/github-backed-writes-go-through-backend.test.ts`,
modelled on `blob-storage-goes-through-secure-storage.test.ts`. It fails if a
`prisma.task.update/create/delete`, `prisma.comment.*` or `prisma.listMember.*` call
appears outside `services/` and `lib/backends/`.

### 5.2 Interface

```ts
// lib/backends/types.ts
export interface TaskBackend {
  kind: 'local' | 'github_project'
  createTask(ctx: ActorCtx, input: CreateTaskInput): Promise<RemoteResult<TaskPatch>>
  updateTask(ctx: ActorCtx, taskId: string, patch: TaskPatch): Promise<RemoteResult<TaskPatch>>
  deleteTask(ctx: ActorCtx, taskId: string, mode: 'remove_from_list' | 'delete'): Promise<RemoteResult<void>>
  addComment(ctx: ActorCtx, taskId: string, body: string): Promise<RemoteResult<CommentPatch>>
  editComment / deleteComment(...)
  moveTask(ctx: ActorCtx, taskId: string, afterTaskId: string | null): Promise<RemoteResult<void>>
  supports(listId: string): ListSupports   // feeds the additive API field in §9.2
}
```

- **`local`** is today's behaviour: an identity pass-through that returns the patch
  unchanged.
- **`github_project`** performs the GitHub mutations and returns **the patch as GitHub
  accepted it**, after normalisation. The caller writes that patch to Postgres.

### 5.3 Where it plugs in

`services/task.service.ts` `create/update/deleteTaskWithSideEffects` becomes:

```
resolve backend from the task's lists  →  backend.<op>(ctx, …)   // remote first
  → prisma transaction: apply returned patch + TaskEvent + notifications
  → SSE / webhooks / analytics (unchanged)
```

These pieces are untouched:
- The side-effect code.
- The v1 response shapers.
- Every read path.

Writes that today bypass the services must be routed through them before a GitHub list
can be writable. That includes the MCP handlers, the legacy `/api/tasks` routes, the
agent routes and copy/move. **This is the largest single piece of work in the spec**,
and it is worth doing on its own merits: it finishes the "slice 1" service layer that
`services/task.service.ts:1–31` already describes.

### 5.4 Partial failure

A GitHub create is several calls:
1. `createIssue` (or `addProjectV2DraftIssue`)
2. `addProjectV2ItemById`
3. N × `updateProjectV2ItemFieldValue`

Where possible these are sent as one GraphQL document with aliased mutations, which
GitHub runs serially. If a later step fails:

- **The content was created** (step 1 succeeded). The task is written to the replica
  with what succeeded, and the failed field writes are enqueued as `writeback-retry`
  jobs. The client sees the task immediately, with a `syncState: "pending"` marker
  (§9.2).
- **Step 1 failed.** Nothing is written, and the error maps onto the existing v1 error
  shape (§9.3).

### 5.5 Offline idempotency

The iOS outbox and the web Dexie queue retry with the same `clientRequestId`. Before
calling GitHub, the backend inserts the `Task` row with `clientRequestId` and
`remoteNodeId = null`, using the existing unique index. A replay finds that row:

- **If it has a `remoteNodeId`**, the create already succeeded. Return it.
- **If it does not**, finish the create.

GitHub offers no idempotency key, and this is how we get one.

---

## 6. Field semantics

### 6.1 Ownership of each field

| Owned by GitHub (authoritative, write-through) | Owned by Astrid (replica-only, never sent) |
|---|---|
| title, body, open/closed + reason, Status, Priority, due date, estimate, assignees, labels, milestone, parent, dependencies, comments, item position, project membership | reminders, personal due-time and all-day overrides (v2), favourites, per-user view preferences, `isPrivate` (disabled), recurrence (disabled), cost, timers, AI-agent assignment metadata |

### 6.2 Status and Priority mapping

- **The bind wizard maps Status automatically.** It reads the project's Status field and
  matches option names, case-insensitively and in English, as follows. The user confirms
  or edits the result.

  | GitHub option | Astrid |
  |---|---|
  | `Todo` | `ready` |
  | `In Progress` | `doing` |
  | `Done` | `completed` |
  | `Blocked` or `Waiting` | `waiting` |
  | anything else | a custom state, `role = gh:<optionId>`, name from the option |

  Because `Project.customStates` already supports custom roles, no new board code is
  needed.
- **Moving a card to the done option** sets `completed = true`. If the item's content is
  an open issue, the issue is **also closed** with reason `completed`. That matches
  GitHub's own built-in "Item closed → Done" workflow in reverse, and stops a task
  showing as done in Astrid while the issue is open in GitHub. The mapping and the
  close are one operation in the backend.
- **Closing an issue in GitHub** fires `issues.closed`. If the project's Status is not
  already the done option, Astrid **does not** write Status back. It renders the task as
  completed, because `completed` derives from `state`, and leaves GitHub's own project
  workflow to move the card. **Astrid never fights a GitHub workflow.**
- **Priority:** options are mapped in order onto 3, 2, 1, 0 (highest first). A project
  with no Priority field hides the priority control, via `supports.priority = false`.

### 6.3 Identifiers

- `Task.identifier = "<owner>/<repo>#<number>"`, displayed as `repo#number`, or
  `owner/repo#number` when two repos in view share a name.
- **Transfers.** `issues.transferred` updates the identifier, and the old value is
  recorded as an alias, so links and typed references keep resolving. This is the same
  promise `ProjectKeyAlias` makes.
- **Drafts** have no identifier. When converted (`projects_v2_item.converted`), they gain
  one. The task id and node id are unchanged, because GitHub keeps the node.
- **Task shortcodes and links** (`astrid.cc/t/…`) keep working: they resolve by Astrid
  task id. A GitHub-backed task also exposes `remoteUrl`.

### 6.4 Custom fields (amends PROJECT_MODE.md:146)

PROJECT_MODE rules out "arbitrary user-defined custom fields". This spec **does not**
add a custom-field model to Astrid. It adds one narrow exception:

> On a list whose `backend` is `github_project`, the task detail pane shows a read-only
> **GitHub fields** section listing every project field that is not mapped onto a native
> Astrid field (§3). It renders nothing on any other list.

- Values live in `Task.remoteFields`. Astrid users cannot create such fields, and Astrid
  lists never grow them.
- **Editing them is v2.** It is a generic editor for single-select, text, number and
  date, keyed by field id.

If accepted, PROJECT_MODE.md:146 gets a one-line pointer here.

### 6.5 Multiple assignees

- **API:** `assigneeIds: string[]` is added as a new v1 task field (additive, so allowed
  by API_CONTRACT). `assigneeId` stays and is always `assigneeIds[0]`.
- **Old clients** (current iOS) see and set the primary assignee. Setting it **replaces
  only the first entry** and leaves the others alone, so an old client never silently
  unassigns people.
- **Classic lists** keep at most one assignee.
- **Assigning someone who is not a GitHub user**, such as an AI agent: see §7.2.

### 6.6 Recurrence, reminders and privacy

- **Reminders** are per-user and stay in Astrid. This is the clearest thing Astrid adds
  on top of GitHub.
- **Recurrence is disabled** on GitHub-backed lists in v1 (`supports.repeating = false`).
  The open question is whether completing a recurring item should create a new issue
  (noisy, but correct) or reopen the same one and bump a date field (quiet, but it
  rewrites history). §11 Q4.
- **`isPrivate`** is meaningless on shared GitHub data, so it is disabled.

---

## 7. Identity, auth and permissions

### 7.1 One GitHub App does everything except Copilot

The deployment registers one GitHub App per brand (`BRAND.githubAppSlug` already
exists). It replaces the `GITHUB_SYNC_*` OAuth app for this backend and keeps serving the
coding agent.

| Permission | Level | Why |
|---|---|---|
| Organization → Projects | read & write | ProjectV2 read and mutations, plus `projects_v2*` webhooks |
| Repository → Issues | read & write | content, comments, labels, sub-issues, dependencies |
| Repository → Pull requests | read (write if the coding agent is on) | PR items |
| Repository → Contents | write, **coding agent only** | unchanged from today |
| Repository → Metadata | read | required |
| Organization → Members | read | role derivation (§7.3) |
| Account → Email addresses | read | sign-in email matching |

**Webhook events:**
- `installation`, `installation_repositories`
- `projects_v2`, `projects_v2_item`, `projects_v2_status_update` (optional)
- `issues`, `issue_comment`, `sub_issues`, `label`, `milestone`
- `pull_request`
- `member`, `membership`, `organization`
- Issue-dependency events where GitHub delivers them. Otherwise the reconciliation pass
  covers dependencies.

### 7.2 Which credential makes each call

| Call | Credential | Why |
|---|---|---|
| A user edits in Astrid | **User-to-server token** from the App's OAuth flow. Expires after 8h and is refreshed with the refresh token. | GitHub attributes the edit to the user and **enforces the user's own permissions**, so Astrid does not re-implement GitHub's permission model. |
| Webhook hydration, reconciliation, membership sync | Installation token | Background work has no user. |
| An AI agent acts (comment, status move) | Installation token (the App bot) | The comment body is prefixed with the agent's display name, e.g. "**Claude** (via \<Brand\>)". Astrid keeps `authorId = agent user`. |
| Assigning an AI agent | No GitHub call | Agents cannot be GitHub assignees. Astrid stores the assignment in the replica, shows it in Astrid, and records it as a label `agent:<name>` in GitHub when `BRAND_GITHUB_AGENT_LABELS` is on, so github.com users can see it. |

**Storage.** Tokens are stored encrypted in `Integration` with `provider = GITHUB_APP`,
a new enum value, using the existing encryption helper.

**Refresh failure.** If refresh fails, the user's GitHub-backed lists become read-only
until they reconnect. The client receives the existing auth-required error code, and no
silent fallback to the installation token is allowed, because that would let a user
write with the App's permissions instead of their own. Pinned by test.

### 7.3 Permissions: GitHub decides, Astrid caches

- **Read visibility.** At sign-in, and every 6h by a `membership` job, Astrid lists the
  projects visible to the user (`viewer` → org `projectsV2`, using the user token).
  It then upserts or removes `ListMember` rows for those projects' lists. The derived
  role is:
  - **admin** for a project admin or org owner
  - **member** for write access
  - **viewer** for read access
- **Write authority** is GitHub's, at call time. A 403 or 404 from GitHub means the
  cached role is stale. Astrid refreshes membership for that user and project
  immediately and returns the existing forbidden error.
- **Not editable in Astrid.** Invite, leave, transfer-ownership and change-role are
  hidden on GitHub-backed lists (`supports.membership = false`) and return 404 server-side,
  per WHITELABELING §3. Membership is managed in GitHub.
- **PRODUCT_CONTRACT's permission matrix still holds** over the derived roles, so web,
  iOS and Windows need no new permission logic. `lib/list-permissions.ts` stays the
  single place that decides.

### 7.4 Sign-in

- **New capability:** `authGithub` (`NEXT_PUBLIC_BRAND_ENABLE_AUTH_GITHUB`).
- **Defaults off**, unlike every other capability, because enabling it requires App
  credentials. The boot assertion in `instrumentation.ts` refuses to start if it is on
  and `GITHUB_APP_CLIENT_ID` is missing.
- **NextAuth** gets a GitHub provider backed by the App's client id and secret, so one
  consent yields both the session and the user-to-server token.
- **Account linking** is by `githubUserId`. A verified primary email matching an
  existing Astrid user links to that user only after the user confirms. Astrid never
  auto-merges accounts on email alone.
- **iOS/Mac:** `ASWebAuthenticationSession` to `/api/auth/github`, mirroring the Apple
  and Google routes that set the session cookie.
- **Copilot** keeps its own OAuth client. It authorises a different product, the
  Copilot API entitlement, and folding it in would put Copilot scopes on everyone's
  sign-in.

### 7.5 GitHub hosts

`GITHUB_API_URL` (default `https://api.github.com`) and `GITHUB_WEB_URL` are read from
one module, `lib/github/host.ts`. This keeps GHE.com data-residency tenants, and later
GHES, a configuration change rather than a fork. A new `check:reuse` rule fails on a
literal `api.github.com` elsewhere.

---

## 8. Sync engine

### 8.1 Shape

```
GitHub ──webhook──▶ /api/github/webhooks  (verify HMAC, dedupe on X-GitHub-Delivery,
                         │                 insert GitHubSyncJob, 202 in < 1s)
                         ▼
                 GitHubSyncJob table ◀── per-minute cron drains (also waitUntil inline)
                         │
                         ▼
          hydrate via GraphQL (installation token, rate-limited)
                         │
                         ▼
          apply(normalised remote state) ─▶ prisma txn ─▶ TaskEvent / SSE / DeletionLog
                         ▲
reconcile job (per project, every 30 min, budgeted) ─┘
```

The webhook handler is the **existing** `app/api/github/webhooks/route.ts`. Projects
events are added to it, and it is re-gated on a new `githubProjects` capability. The
coding events are re-gated on their own capability, which also fixes G14.

### 8.2 Hydration

`projects_v2_item` payloads carry the item node id and the changed field id, not the
values. A single `apply` step fetches the item with all field values and its content,
using one GraphQL query with a fixed fragment. The webhook payload is treated as a
*trigger* and never as data, so out-of-order delivery is harmless: whichever hydration
runs last reads the latest state.

### 8.3 Reconciliation

GitHub does not guarantee webhook delivery. A per-project `reconcile` job pages through
the project's items, 100 per page, with field values. It upserts differences and
detects deletions: an item the project no longer returns, absent from two consecutive
full scans, is removed. This is the deletion guarantee the current Issues engine
deliberately lacks (`apply-issues.ts:17–28`).

- **Interval** scales with item count, from 30 minutes to 6 hours, and is budgeted
  against the installation's GraphQL points (§8.5).
- **Failed deliveries** in GitHub's delivery log are redelivered by an hourly job using
  the App's `GET /app/hook/deliveries` API.

### 8.4 Apply, conflicts and echo

- **Apply compares values, not timestamps.** It writes only fields whose normalised
  remote value differs from the replica, and emits TaskEvents and SSE only for those
  fields. An echo of Astrid's own write is therefore a no-op by construction. This
  removes the timestamp watermark scheme (G5) for this backend.
- **Conflict rule.** The replica always converges to GitHub. An Astrid write that GitHub
  accepted *is* GitHub's state. An Astrid write that GitHub rejected never reaches the
  replica.
- **Offline edits** replayed late are applied as a fresh write against current GitHub
  state, field by field. The last write to GitHub wins, which matches github.com's own
  behaviour. Body edits on a body changed remotely since the client's base version
  return the existing conflict error, rather than overwriting someone's paragraph. Base
  version = `remoteVersion` sent by the client.
- **Deletion semantics.**

  | Event | Effect in Astrid |
  |---|---|
  | `projects_v2_item.deleted` or `.archived` | Task leaves that list (`DeletionLog` entry for that membership) |
  | `issues.deleted` | Task deleted |
  | Issue still exists elsewhere | Task survives in its other lists |
  | `.restored` | Task returns to the list |

  An Astrid "delete" on a GitHub-backed list means **remove from project** by default.
  Deleting the issue itself needs repo admin rights and an explicit confirmation.

### 8.5 Rate limits

`lib/github/rate-limiter.ts` is the only GitHub HTTP client for this backend. It wraps
Octokit with throttling and retry plugins, plus a Redis token bucket.

- **Limits tracked:** primary limits per token from `x-ratelimit-remaining` and
  `x-ratelimit-reset`; GraphQL point cost from `rateLimit { cost remaining }`, requested
  on every query; and secondary limits via `retry-after` and the documented
  content-creation caps.
- **Bucket keys:** user id for user tokens, installation id for installation tokens.
- **User-facing writes take priority** over reconciliation. Reconcile yields when the
  installation budget is below 20%.
- **Timeouts:** 15s on every call, closing the G7 gap in `githubGraphQL`.

### 8.6 What happens to today's GitHub Issues sync

The repo-level Issues sync stays for Astrid's own build (iOS still runs it). On a
GitHub-Projects brand, `syncGithubIssues` is **off**: the Projects backend subsumes it,
and two engines writing one issue is exactly the G9 failure. Converging the Issues sync
onto `TaskBackend` and the job queue is follow-up work, out of scope here.

---

## 9. API and client contract

### 9.1 Brand and capabilities

New, all in `lib/brand/capabilities.ts` and documented in WHITELABELING §3 in the same
change:

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_BRAND_ENABLE_AUTH_GITHUB` | **off** (§7.4) | Sign in with GitHub |
| `NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS` | **off** | The `github_project` backend exists |
| `NEXT_PUBLIC_BRAND_TASK_BACKEND` | `local` | `github_projects` makes new shared boards GitHub-backed by default, puts the bind wizard on first run, and hides "Create board" for local boards. Personal local lists stay unless `BRAND_ALLOW_LOCAL_LISTS=false` (§11 Q2). |
| `BRAND_GITHUB_AGENT_LABELS` (server) | `true` | Mirror agent assignment as a label (§7.2) |
| `GITHUB_APP_CLIENT_ID` / `_SECRET` / `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` | — | Already exist for the coding agent. Client id and secret are new. |

**New brand profile:** `brands/github-projects.brand.json` (the partner name is a
placeholder), with:

```json
"NEXT_PUBLIC_BRAND_ENABLE_AUTH_GITHUB": "true",
"NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE": "false",
"NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE": "false",
"NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS": "true",
"NEXT_PUBLIC_BRAND_TASK_BACKEND": "github_projects",
"NEXT_PUBLIC_BRAND_ENABLE_SYNC_GITHUB_ISSUES": "false",
"NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS": "false",
"NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE": "true",
"NEXT_PUBLIC_BRAND_ENABLE_TASK_COST": "false"
```

**Boot assertion.** `GITHUB_PROJECTS` on with `PROJECT_MODE` off is a contradiction, so
the process refuses to boot.

**At least one auth method must remain** (WHITELABELING §3). That check now counts
`authGithub`.

**Trademark.** A partner's product name must not *start with* or imitate "GitHub".
"\<Brand\> for GitHub Projects" is the descriptive form GitHub's brand guidelines allow.
`check:brands` gains a lint rejecting `NEXT_PUBLIC_BRAND_NAME` values matching
`/^git ?hub/i`.

### 9.2 Additive v1 fields

All additive, as API_CONTRACT permits.

**List**

```jsonc
"backend": "github_project" | null,
"remote": { "url": "...", "owner": "acme", "number": 12 } | null,
"supports": {            // every key true on classic lists
  "repeating": false, "privateTasks": false, "membership": false,
  "priority": true, "dueDate": true, "comments": true, "multipleAssignees": true,
  "deleteTask": "remove_from_list"
}
```

**Task**

```jsonc
"assigneeIds": ["…"],
"remote": { "kind": "issue", "url": "...", "nodeId": "I_…", "version": "…" } | null,
"remoteFields": [{ "fieldId": "…", "name": "Team", "type": "single_select", "value": "Web" }],
"syncState": "synced" | "pending" | "error"
```

**`GET /api/v1/capabilities`** adds `githubProjects` and `authGithub`.

**New routes**, all `withAuth({ capability: 'githubProjects' })`:

| Route | Purpose |
|---|---|
| `GET /api/v1/github/projects` | Projects the user can bind |
| `POST /api/v1/github/projects/{nodeId}/bind` | Wizard result, creates the Project, list and binding |
| `GET/PATCH /api/v1/github/projects/{projectId}/binding` | Field mapping |
| `DELETE /api/v1/github/projects/{projectId}/binding` | Unbind. Keeps a local snapshot, read-only |
| `POST /api/v1/github/projects/{projectId}/reconcile` | Admin, forces a pass |

### 9.3 Errors

GitHub errors map onto the **existing** v1 error codes, so clients need no new handling:

| GitHub | v1 error |
|---|---|
| 401 or refresh failure | `auth_required` |
| 403 or 404 | `forbidden` (after the membership refresh) |
| 409 or a stale body base | `conflict` |
| Secondary rate limit | `rate_limited`, with `retryAfter` |
| 5xx | `upstream_unavailable` (new, additive) |

### 9.4 Clients

- **Web.** Read `list.supports.*` to hide unsupported controls, and render the GitHub
  fields section (§6.4), a `repo#N` identifier chip linking to `remote.url`,
  `syncState: pending` as a subtle indicator, and multiple assignee avatars. No change
  to the data layer, cache, offline queue or SSE handling.
- **iOS/Mac** (astrid-ios). GitHub sign-in, the same `supports` gating, and multiple
  assignees. **Disable the on-device GitHub Issues engine** for GitHub-backed lists. The
  outbox and delta sync are unchanged.
- **Windows.** Replays PRODUCT_CONTRACT fixtures. The fixtures gain a GitHub-backed list
  so `supports` gating is covered.
- **MCP / agents.** No new tools. Existing tools route through `TaskBackend` (§5.3), so
  an agent working a GitHub-backed board writes to GitHub.

---

## 10. Delivery plan

Each phase ships behind the capability, which is off by default, so astrid.cc is
unaffected throughout. Sizes are relative: S = days, M = 1–2 weeks, L = 3+ weeks.

| Phase | Scope | Size | Exit criterion |
|---|---|---|---|
| **P0 Seam** | Route every task, comment and membership write through `services/` (MCP, legacy `/api/tasks`, agent routes, copy/move). Add `TaskBackend` with the `local` implementation. Add the rule test from §5.1. Fix G14. | **L** | Rule test green, full suite green, zero behaviour change on astrid.cc |
| **P1 Identity** | Consolidate onto one GitHub App. `authGithub`, user-to-server tokens with refresh, `lib/github/{host,rate-limiter}.ts`, `GitHubSyncJob` plus cron drain. | M | Sign in with GitHub on a preview brand. Limiter unit-tested against recorded 403 and `retry-after` responses. |
| **P2 Read-only mirror** | `GitHubWorkspace`, binding wizard, initial import, webhooks, hydration, reconcile, membership derivation, deletion semantics. Lists are bound read-only. | L | A 2,000-item org project mirrors within 5 min. Edits in github.com reach Astrid in under 10s at p95. A killed webhook is healed by reconcile. |
| **P3 Write-through core** | Create (draft or issue), title, body, Status with Done-closes, assignees, comments, position, remove-from-project, offline idempotency, partial-failure retry. | L | Every write attributed to the acting GitHub user. Replaying an outbox twice creates one issue. |
| **P4 Rich fields** | Priority, due, estimate, labels as label lists, iteration and milestone virtual lists, sub-issues, dependencies, PR items, read-only GitHub fields panel, multiple assignees across API and clients. | M | Field-mapping fixtures for each GitHub field type |
| **P5 Brand and clients** | `brands/github-projects.brand.json`, copy pass ("board" and "project" wording), iOS/Mac sign-in and gating, Windows fixtures, App listing, partner docs in WHITELABELING §8. | M | `npm run check:brands` green. The brand audit finds no Astrid literals. A partner preview is deployed. |

### Testing strategy

- **Contract fixtures.** Recorded GraphQL and REST responses for each item kind, field
  type and webhook action, under `tests/fixtures/github-projects/`. Apply is a pure
  function from normalised remote state to a replica patch, so most behaviour is
  unit-testable without network access.
- **A fake `TaskBackend`** for the service-layer suite, so every existing
  `*WithSideEffects` test also runs against a remote-first backend that can fail at each
  step.
- **Rule tests:** writes go through the backend (§5.1); no literal GitHub host (§7.5);
  no installation-token fallback for user writes (§7.2).
- **Brand matrix:** the new profile joins `tests/brands/brand-matrix.test.ts`
  automatically.
- **A live smoke test** against a dedicated test org, gated on a secret. It is not part
  of predeploy.

---

## 11. Open questions (need a decision)

| # | Question | Recommendation |
|---|---|---|
| Q1 | **Who is the first customer?** One partner org, so each deployment is one org, or a multi-org SaaS? | Build `GitHubWorkspace` regardless. It is cheap, and it is the boundary for permissions and rate limits either way. Pricing and the Marketplace listing follow the answer. |
| Q2 | **Personal local lists on the GitHub brand?** | **Yes.** "My day", reminders and personal to-dos alongside work issues are the reason to use \<Brand\> instead of github.com. Default `BRAND_ALLOW_LOCAL_LISTS=true`. |
| Q3 | **User-owned projects?** They have no webhooks, so polling only. | v2. They need a per-user polling budget, which conflicts with the rate-limit design for org projects. |
| Q4 | **Recurrence on GitHub-backed lists?** | Ship disabled. Revisit with real usage. If enabled, use "create the next issue", which keeps GitHub history honest. |
| Q5 | **Should astrid.cc offer GitHub Project boards** as an opt-in list type? | Yes after P3. It is the same code, it retires the repo-level Issues sync for new users, and it dogfoods the partner product. |
| Q6 | **Amend PROJECT_MODE** with the read-only GitHub fields panel (§6.4)? | Yes, as scoped. Editing stays v2. |
| Q7 | **GHES support?** | Configuration-ready in P1 (§7.5). Untested until a customer needs it. |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| GitHub rate limits on large orgs (thousands of items, many users) | Write-first priority, reconcile budgeting, webhook-driven incremental updates. Measure in P2 against a large real project before committing to P3. |
| GitHub API changes (Projects REST is newer, Sept 2025) | GraphQL is primary. REST is used only where it is the sole option. Fixtures catch shape drift in CI. |
| Writes look like "Astrid did it" instead of the user | User-to-server tokens only for user actions, pinned by test (§7.2). |
| Two engines editing one issue | `syncGithubIssues` is forced off on this brand, and iOS's engine is disabled per list (§8.6, §9.4). |
| P0 is large and touches everything | It is pure refactor with no behaviour change, verified by the existing ~3,000-test suite. It is also the prerequisite for any future backend (Linear, Jira), so the cost is not GitHub-specific. |
| Trademark | Descriptive naming only, linted (§9.1). |

---

*Sources for GitHub platform facts (checked 2026-10-04):*
- [REST API for GitHub Projects (2025-09-11)](https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/)
- [Projects v2 webhooks are limited to org webhooks and GitHub Apps](https://github.com/orgs/community/discussions/17405)
- [Sub-issues REST API](https://docs.github.com/en/rest/issues/sub-issues)
- [Issue dependencies REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/issues/issue-dependencies)
- [Issues and Projects GA: sub-issues, issue types](https://github.com/orgs/community/discussions/154148)
