# Spec: Astrid as a white-label client for GitHub Projects

*Spec of record for running Astrid's apps as a multi-org service on top of GitHub
Projects (v2). This also covers the three workstreams that make it possible:
consolidating the write path, a login-provider registry, and one GitHub connection.
Revision 2, 2026-10-05.*

Status: **In progress — P0, P1, P2 done; P3 partly done; P4–P8 not started** (2026-10-05).
See §17 for exactly what landed, what did not, and what each remaining phase needs. None
of it is deployed: production deploys are manual (CLAUDE.md rule 1).

Companions:
- [WHITELABELING.md](../WHITELABELING.md) covers brand identity and capabilities. This
  spec adds to that system and builds nothing parallel to it.
- [PROJECT_MODE.md](../product/PROJECT_MODE.md) covers boards and statuses. §9.4 amends
  it for GitHub fields.
- [TASK_IDENTIFIERS.md](./TASK_IDENTIFIERS.md) and
  [TASK_BLOCKING_DEPENDENCIES.md](./TASK_BLOCKING_DEPENDENCIES.md) are the models GitHub
  numbers, sub-issues and dependencies map onto.
- [PERFORMANCE_BUDGETS.md](../PERFORMANCE_BUDGETS.md) holds the budgets that §13 holds
  this work to.

---

## 0. The ask and the decisions

### 0.1 The ask

> *"Do a full architecture review between the current Astrid project and GitHub
> projects. What would we need to do to make Astrid white label the app for GitHub
> projects? Define the spec to support."*

### 0.2 Decisions (Jon, 2026-10-05)

| # | Decision | Where it lands |
|---|---|---|
| D1 | **A service for many orgs**, not one deployment per org | §8.1 tenancy = GitHub App installation |
| D2 | **Personal Astrid lists are allowed** alongside GitHub boards | §8.2 |
| D3 | **A recurring task creates a new issue, linked to the last completed one** | §10 |
| D4 | **Project Mode shows GitHub custom fields, ideally read and write** | §9.4, read and write, no new UI concepts |
| D5 | **astrid.cc must NOT offer GitHub Project boards** | §8.3. The capability defaults off and is pinned off for the Astrid brand. |
| D6 | **Login providers are a standard part of white-label setup**: GitHub, Google, Apple, passkey, SSO | §6 |
| D7 | **Consolidate the GitHub connection** | §7 |
| D8 | **Write-path consolidation is the most important change.** Build red-green TDD, clean and performant. | §5, §13, §14 |

### 0.3 The answer in one paragraph

The design has six parts:

1. **GitHub owns the shared data.** For lists bound to a GitHub Project, GitHub is
   authoritative.
2. **Postgres is a replica.** Postgres keeps a write-through replica, so every read path
   is unchanged: v1 API, delta sync, SSE, offline, and the permission joins.
3. **Writes go to GitHub first,** under the acting user's own GitHub identity.
4. **Inbound changes arrive by webhook,** plus a budgeted reconciliation pass.
5. **The brand chooses.** The backend exists only in a brand that enables it, and never
   in Astrid's own build.
6. **The prerequisites are cleanups the codebase needs anyway:**
   - one write path, closing about 45 bypass sites (§5)
   - one sign-in helper behind a provider registry (§6)
   - one GitHub App connection replacing three credentials (§7)

---

## 1. Is the write model controlled? (correcting revision 1)

Revision 1 said "most code queries the database directly". **That overstated it.** The
measured picture is better, and more specific:

| Measure | Count | Meaning |
|---|---:|---|
| Client-facing task write surfaces through `services/task.service.ts` | **7 of 7** | Legacy `/api/tasks`, v1, v1 agent, MCP HTTP, stdio MCP. Locked by `tests/rules/task-write-surfaces-delegate.test.ts`. |
| Comment routes through `createCommentWithSideEffects` | all user-facing | Task comments (legacy, v1, agent), MCP comment operations |
| Task list-membership changes on existing tasks outside services | **0** | Clean |
| Raw `task.create/update/updateMany` sites outside `services/` | **~23** | The long tail: agents, webhooks, cron, copy, email-to-task, sync |
| Raw `comment.create` sites outside `comment.service` | **14** | Mostly agent and coding-workflow comments |
| Raw `listMember.*` writes outside `list-member.service` | **~9** | Legacy list routes, invitations, custom-agent register |
| Prisma **read** sites (`find*`/`count`) on task, list, comment, member, project | 271 | **Irrelevant to this design.** The replica is still Postgres, so reads stay. |

**Verdict.** The *front door* is controlled. The service layer and its rule test do their
job for every surface a user or client calls. The *side doors* are not controlled:
agents completing tasks, GitHub webhooks, the coding workflow, invitations, email-to-task
and copy. That is where the verified bugs in §2 live. The same doors would let a
GitHub-backed task change without GitHub hearing about it.

`lib/prisma.ts` also has a `$extends` hook on `task.update` that starts AI-agent runs
whenever `assigneeId` changes. This **second, hidden implementation** of "an agent was
assigned" duplicates `lib/webhooks/task-assignment-notifier.ts`, and no test covers it.
It turns any raw assignee write into a billable agent run (§2, S3).

So you were right to rank the write path first. The work is smaller and better defined
than revision 1 implied: about 45 named sites, not "everything" (§5).

---

## 2. Defects found during this review: fix first, independent of GitHub

Each was read in the code and confirmed. Each gets a RED regression test before its fix,
per ASTRID.md's coding workflow. **These should be filed and fixed now.** None of them
waits on the GitHub work.

### Security

| # | Defect | Evidence | Fix |
|---|---|---|---|
| **S1** | **Any signed-in user can claim any unclaimed GitHub App installation.** They then drive the coding agent with that org's installation token, which has contents-write access. | `app/api/github/installations/route.ts:99–114` lists every installation of the App not yet claimed. `connect-installation/route.ts:45–56` checks only that no *other* user claimed it. `manual-setup` has the same shape, gated only client-side (`components/github-integration-settings.tsx:78`). `setup` doesn't verify its unsigned `state`. | Prove access with the user's own token: `GET /user/installations` must include the id. Until user tokens exist (§7), only accept an `installation_id` arriving on the `setup` callback with a signed `state` bound to the session. Remove the "detected installations" listing. |
| **S2** | **Web Google sign-in links to an existing account by email** without checking `email_verified` and without `adoptUnverifiedAccount`, then marks the email verified. This is the passkey pre-hijack that task 1a52195f closed on mobile, still open on web. | `lib/auth-config.ts:181–242`. Also `customAdapter.linkAccount` (`:98–108`) silently moves an existing provider identity to another user. | Route the web Google path through the shared verified-identity helper (§6.3). `linkAccount` refuses to re-home an identity. |
| **S3** | **`POST /api/invitations` assigns a task to any existing user by email**, AI agents included. This skips `authorizeAssigneeChange`. The raw write then trips the `$extends` hook and starts an agent run billed to the list's configured user, which is the attack AWTD-891 closed in the service. | `app/api/invitations/route.ts:86` | Route through `updateTaskWithSideEffects`, which applies the assignee rule. |

### Correctness

| # | Defect | Evidence | Fix |
|---|---|---|---|
| **B1** | **Deleting a custom board status fails every time.** The query filters `task.updateMany({ where: { listId: … } })`, but `Task` has no `listId`. Prisma throws "Unknown argument", the transaction aborts, and the route returns 500. tsc misses it because Prisma's generic `SelectSubset` skips excess-property checks. The unit test mocks Prisma and **asserts the broken shape**. | `lib/projects-service.ts:498`; `tests/api/v1-project-statuses.test.ts:235` | `where: { lists: { some: { id: { in: listIds } } }, statusRole: role }`. Also clear `statusRoleBeforeDone === role`. Replace the mock-shape assertion with a behavioural test against the contract-test database. |
| **B2** | **v1 member removal never broadcasts or invalidates.** The route deletes the row, *then* calls `removeListMember`, whose `deleteMany` finds 0 rows and returns early. This is task e27642cc ("removed agent keeps showing back up"), regressed. The test mocks `deleteMany → {count: 1}`, which hides it. | `app/api/v1/lists/[id]/members/[userId]/route.ts:176–195`; `services/list-member.service.ts:225–228` | Delete the raw `listMember.delete`. |
| **B3** | **The final occurrence of a terminating recurring series never completes.** The terminate branch writes `repeating: 'never'` but never `completed: true`. The service then returns early as "rolled forward", so the user has to complete it twice. | `lib/repeating-task-handler.ts:139–150`; `services/task.service.ts:1124–1147`; `lib/task-update-handler.ts:88` | Set `completed`, `completedAt` and `completedSource` in the terminate branch via `resolveCompletionFields`. The parity tests only mock `shouldTerminate: false`; add the true case. |
| **B4** | **Five raw `completed: true` writes** skip the completion stamp, statusRole clearing, dependency promotion (blocked tasks stay blocked), repeating roll-forward (series die), reminders, TaskEvent and SSE. GitHub Issues apply does the same, without `completedSource: 'github'`. | `app/api/webhooks/ai-agents/route.ts:215`, `app/api/github/webhooks/route.ts:225`, `app/api/coding-workflow/merge-request/route.ts:120`, `lib/comment-approval-detector.ts:436`, `lib/system-tasks.ts:136`, `lib/sync/github/apply-issues.ts:156,182` | One completion path (§5, step 2). |
| **B5** | **The coding agent is gated on the Issues-sync capability.** Turning off Issues sync silently turns off the coding agent. | `app/api/github/webhooks/route.ts:399,460` and every `app/api/github/*` route | Split the capabilities (§7.5). |

---

## 3. Architecture review: Astrid against GitHub Projects

### 3.1 What already helps

| Asset | Where | Why it matters |
|---|---|---|
| Brand and capability system with server-side 404 gating and a brand matrix | `lib/brand/*`, `brands/*.brand.json`, `tests/brands/brand-matrix.test.ts` | A GitHub brand is a profile, not a fork. "astrid.cc never offers it" (D5) is one assertion. |
| A front door to the service layer, plus rule tests | `services/task.service.ts`, `tests/rules/*` | The seam for a remote-first backend already exists for the main surfaces. |
| External-link tables, cursor discipline, echo watermarks | `Integration`, `ExternalListLink`, `ExternalTaskLink`, `lib/sync/github/*` | Patterns to reuse; the timestamp conflict rule itself is replaced (§8.7). |
| GitHub App with HMAC-verified webhook and installation tokens | `lib/github-client.ts`, `app/api/github/webhooks` | The base for the single connection (§7). |
| Status is a task field; custom states exist | `Task.statusRole`, `Project.customStates` (AWTD-562) | One-to-one with a Projects Status single-select. |
| Subtasks, dependencies, closed reason | `parentTaskId`, `TaskDependency`, `closedReason` | GitHub sub-issues, issue dependencies, `state_reason`. |
| Nullable `Project.key` | `prisma/schema.prisma:255` | GitHub-backed projects mint no Astrid keys, so there is no cross-org key collision. |
| Provider-agnostic desktop hand-off | `DesktopAuthGrant`, `/api/v1/auth/desktop/exchange` | The native-app path for every browser-based login (GitHub, SSO) without per-provider native SDKs (§6.5). |
| astrid-core recurrence arithmetic | `lib/repeating-rollover.ts` (AWTD-1063) | "Spawn next issue" reuses the same date arithmetic (§10). |

### 3.2 Gaps

| # | Gap |
|---|---|
| G1 | No Projects v2 code: no ProjectV2, item, field or option ids anywhere. GraphQL is used for one lookup. |
| G2 | Three GitHub credentials (OAuth app with `repo` scope, GitHub App, Copilot OAuth), three token stores, two client libraries, two webhook endpoints, and five inline `new App(...)` (§7.1). |
| G3 | No GitHub sign-in and no SSO. The sign-in logic is copied across five places that have drifted (§6.1). |
| G4 | The sync container is a repo (`"owner/repo"`). PRs are filtered out. |
| G5 | Conflicts are last-writer-wins by timestamp, and Astrid wins within a pass. That is the wrong polarity when GitHub is authoritative. |
| G6 | Webhooks only nudge and need manual setup per repo. There are no `projects_v2*` events, which GitHub delivers **only** to org webhooks and Apps. |
| G7 | No rate-limit handling or GraphQL point budgeting; `githubGraphQL` has no timeout. |
| G8 | No durable job queue. |
| G9 | Two sync engines (iOS Swift, server subset) and no provider interface. |
| G10 | Side-door writes (§1) and the hidden `$extends` dispatch. |
| G11 | Single assignee; GitHub allows up to 10. |
| G12 | No tenancy boundary (needed for D1). |
| G13 | Custom fields are excluded by PROJECT_MODE.md:146 (amended in §9.4). |
| G14 | Recurrence rolls the same row forward, and iOS runs the rule on the device. D3 needs a second, server-owned mode (§10). |
| G15 | **The full task response is already at 88% of its 500 KiB on-the-wire budget** (PERFORMANCE_BUDGETS, measured 2026-09-11). Custom-field values cannot simply be added to every task (§9.4.3). |

### 3.3 The shape: remote-authoritative replica

| | Shape | Verdict |
|---|---|---|
| A | GitHub *is* the database; rewrite every read | **Rejected.** It breaks permission joins, delta sync and `DeletionLog`, the SSE audience, offline idempotency, client-side filtering over a full fetch, transactional side effects, agents-as-users and MCP. Every client launch would also hit GraphQL limits. |
| **B** | **GitHub authoritative; Postgres is a write-through replica plus a home for Astrid-only fields** | **Chosen.** Reads and clients are unchanged. The new code sits behind one write seam (§5.3) and one sync engine (§8.5). |
| C | Postgres authoritative; two-way sync | **Rejected.** Two writers with timestamp last-writer-wins silently overwrites people's edits, and users *will* edit on github.com too. |

---

## 4. Workstream map and dependencies

```
W1 Write-path consolidation (§5) ────────────────┐
W2 Login-provider registry  (§6) ──┐             │
W3 One GitHub connection    (§7) ──┴──▶ W4 GitHub Projects backend (§8–§11)
                                                 ▲
§2 defects (S1–S3, B1–B5): fixed inside W1/W2/W3 ─┘   W5 Brand + clients (§12)
```

- **W1, W2 and W3 have value with or without W4.** W1 fixes live bugs. W2 is the
  white-label login story every partner needs. W3 closes S1 and B5 and simplifies GitHub
  for astrid.cc's Issues sync and coding agent.
- **W1 and W2 can run in parallel.** W3 depends on W2 for GitHub sign-in. W4 depends on
  all three.

---

## 5. W1: one write path

### 5.1 Target rule

> **Every write to `Task`, `Comment` or `ListMember` goes through `services/`.** The
> exceptions are a short, named allow-list of Astrid-only bookkeeping fields, for example
> `reminderSent`, and the atomic fixall claim.

Enforced by a ratchet rule test,
`tests/rules/entity-writes-go-through-services.test.ts`, built from:
- **The tree walk and failure message** of `blob-storage-goes-through-secure-storage.test.ts`.
- **An `ALLOWED: Record<file, reason>` map.** It starts with the reminder files and the
  service-internal helpers.
- **The slack check** of `prisma-in-routes-ratchet.test.ts`, so allow-list entries must
  be removed as sites migrate.

Regex, scanned over `app lib mcp`:

```
/\b(?:prisma|tx|client|this\.prisma)\.(task|comment|listMember)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/
```

The existing `task-write-surfaces-delegate` test only scans seven files, and its regex
misses `tx.`, `updateMany` and `createMany`. The new test supersedes it.

**Companion rule:** no `completed: true` literal in a task write outside `services/`.

### 5.2 Steps, each strictly red then green

Each step is its own PR. Each starts with a failing test that names the task id. Each
ends with `npm run predeploy`, and with the full suite when auth is touched.

| Step | Change | RED test first | Sites |
|---|---|---|---|
| 1 | **Fix S3, B1, B2, B3** | S3: assigning an agent through `POST /api/invitations` is refused 403 and starts no run. B1: deleting a status against the contract-test DB (not a Prisma mock) clears the role and returns 200. B2: v1 member DELETE broadcasts `list_member_removed` and invalidates, with a real `deleteMany` count. B3: completing the last occurrence leaves `completed = true` and `completedAt` set. | 4 |
| 2 | **One completion path.** The five raw completions and GitHub Issues apply call `updateTaskWithSideEffects({ completed: true, actorType: 'agent' \| 'system' \| 'integration', completedSource })`. | Per site: completing via that entry point clears `statusRole`, promotes dependents, rolls a repeating task forward, emits `task_updated`. One test, parameterised over the entry points. | 6 |
| 3 | **Delete the `$extends` hook.** Assignee-change agent dispatch moves into the service update path using the one implementation in `task-assignment-notifier.ts`. | Assigning an agent via the service update dispatches **exactly once**. A raw `prisma.task.update({assigneeId})` dispatches **nothing**. The rule test forbids raw `assigneeId` writes. | 1 + 2 duplicate implementations removed |
| 4 | **Agent and system comments go through the service.** `createCommentWithSideEffects` gains `author: { kind: 'user' \| 'agent' \| 'system' }` with a loop guard: an agent-authored comment never re-dispatches to agents. | Each migrated site emits `comment_created` to the list audience. An agent comment does not trigger `processAstridComment`. | 12 |
| 5 | **Creates go through the service:** email-to-task, system tasks, task copy, batch copy (which also gets the missing assignee rule). Delete dead `lib/database-utils.ts:198`. | Each created task gets an identifier on a project list, reminders and a broadcast. Batch copy refuses a caller-supplied agent assignee. | 5 |
| 6 | **Membership through `list-member.service`:** legacy list PUT member replace, the legacy `leave` action (a third leave implementation), invitation accept, custom-agent register. | Each emits `list_member_*` and invalidates. Leave has one implementation, asserted via `bodyOf()`. | ~7 |
| 7 | **Turn on the ratchet** (§5.1) with the allow-list at its final size. | The rule test itself, with a planted violation proving it fires. | — |
| 8 | **Add the `TaskBackend` seam** (§5.3) with only the `local` implementation. This is a pure refactor. | The full suite is unchanged. A fake remote backend runs the `*WithSideEffects` suite (§14.2). | — |

**Size.** About 45 sites over 8 PRs. Steps 1–2 are days. Steps 3–6 are the bulk, about
two weeks. Steps 7–8 are small. **This is the critical path for everything else.**

### 5.3 The seam

```ts
// lib/backends/types.ts
export interface TaskBackend {
  readonly kind: 'local' | 'github_project'
  createTask(ctx: ActorCtx, input: CreateTaskInput): Promise<RemoteResult<TaskPatch>>
  updateTask(ctx: ActorCtx, taskId: string, patch: TaskPatch): Promise<RemoteResult<TaskPatch>>
  deleteTask(ctx: ActorCtx, taskId: string, mode: 'remove_from_list' | 'delete'): Promise<RemoteResult<void>>
  setFieldValue(ctx: ActorCtx, taskId: string, projectId: string, fieldId: string, value: FieldValue | null): Promise<RemoteResult<FieldValue | null>>
  addComment(ctx: ActorCtx, taskId: string, body: string): Promise<RemoteResult<CommentPatch>>
  editComment(ctx: ActorCtx, commentId: string, body: string): Promise<RemoteResult<CommentPatch>>
  deleteComment(ctx: ActorCtx, commentId: string): Promise<RemoteResult<void>>
  moveTask(ctx: ActorCtx, listId: string, taskId: string, afterTaskId: string | null): Promise<RemoteResult<void>>
  completeRecurring(ctx: ActorCtx, taskId: string): Promise<RemoteResult<RecurrenceOutcome>>  // §10
  supports(listId: string): ListSupports                                                       // §11.2
}
```

- **`local`** passes the patch straight through (identity).
- **`github_project`** performs the mutations and returns the patch **as GitHub accepted
  it**. The service then writes that patch and runs the unchanged side effects:

```
resolve backend from the task's lists → backend.<op>() → prisma txn (patch + TaskEvent) → SSE/webhooks
```

**Which backend?** A task's backend is `github_project` if **any** of its lists is
GitHub-backed. GitHub-owned fields then route remotely. Astrid-only fields (§9.1) and
personal-list membership stay local. This is how D2 coexists with D1.

---

## 6. W2: login providers as standard white-label configuration

### 6.1 Today

| Fact | Evidence |
|---|---|
| Three boolean flags: `authGoogle`, `authApple`, `authPasskey`, each **default on** | `lib/brand/capabilities.ts` |
| NextAuth registers **only Google**. Apple exists only as mobile routes; web has no Apple button. | `lib/auth-config.ts:148–161` |
| Five copies of "find user → link → adopt → create → mint session": the web `signIn` callback, `/api/auth/{apple,google}`, `/api/v1/auth/{apple,google}`. They have drifted: Google never looks up by Google user id first, Apple does. | as cited |
| Two session formats: JWT for web, passkey and desktop; DB rows with a host-only, non-`__Secure-` cookie for mobile Apple and Google | `app/api/auth/apple/route.ts:175–212` |
| The boot check counts flags, not credentials | `instrumentation.ts:25`, `lib/env.ts:90` |
| Clients learn providers from `GET /api/v1/capabilities` `auth: {google, apple, passkey}`. iOS treats a missing key as "offered". | `app/api/v1/capabilities/route.ts:34–38`; `ServerCapabilities.swift:29–31` |
| Hard-coded Astrid identities: Google client id, Apple bundle ids, astrid.cc preview bounce | `lib/auth/google-identity.ts:21`, `lib/auth/apple-identity.ts:37`, `lib/auth-host.ts:41` |
| No SSO of any kind | — |

### 6.2 Configuration

```bash
# Ordered: this is also the button order. Unset = derived from the legacy flags,
# so Astrid's build is byte-for-byte unchanged.
NEXT_PUBLIC_BRAND_AUTH_PROVIDERS="github,google,apple,passkey,sso"
```

| Provider | Kind | Required env (boot fails if missing) | Email trust |
|---|---|---|---|
| `google` | OAuth/OIDC (web) + native id token (iOS) | `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_ALLOWED_AUDIENCES` | `email_verified` claim |
| `apple` | **Web provider (new)** + native id token | `APPLE_CLIENT_IDS`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (web) | `email_verified` claim |
| `github` | OAuth via the **GitHub App's** client (§7) | `GITHUB_APP_CLIENT_ID/SECRET` | Verified **primary** email from `GET /user/emails`. Never the profile email. |
| `passkey` | WebAuthn | — (RP ID per WHITELABELING §7) | None. Verified by email loop, as today. |
| `sso` | OIDC, per connection (§6.4) | v1: `AUTH_SSO_ISSUER`, `AUTH_SSO_CLIENT_ID/SECRET`, `AUTH_SSO_DOMAINS`, `AUTH_SSO_LABEL` | **Domain-bound:** trusted only for the connection's verified domains |

Rules:
- **Every new provider defaults off.** Listing it is the only way to enable it. The
  existing "on unless set" convention must not apply to a provider that needs
  credentials, or every existing deployment sprouts broken buttons. iOS's decoder changes
  to default-off for unknown providers in the same release.
- **The legacy `NEXT_PUBLIC_BRAND_ENABLE_AUTH_*` flags keep working** as removals from
  the derived list. `check:brands` warns when both forms are set. They are deprecated in
  WHITELABELING §3, never silently ignored.
- **At least one provider must remain,** as today. The check moves to the registry.

### 6.3 One sign-in helper (also fixes S2)

```ts
// lib/auth/sign-in-with-verified-identity.ts
signInWithVerifiedIdentity({
  provider, providerAccountId,          // stable subject: Google sub, Apple sub, GitHub numeric id, OIDC iss+sub
  email, emailTrust,                    // 'verified' | 'domain-bound' | 'none'
  ssoConnectionId?,
  profile: { name?, image? },
}): Promise<{ userId, created, linked }>
```

1. **Look up by `(provider, providerAccountId)` first.** If found, that user. Done.
2. **Otherwise, link by email only when `emailTrust` allows it.** For `domain-bound`, the
   email's domain must be one of the connection's verified domains. Linking always calls
   `adoptUnverifiedAccount`, which closes the passkey pre-hijack.
3. **Never link an SSO identity to** an `isAIAgent` user, any address at
   `BRAND.agentEmailDomain`, or `INITIAL_ADMIN_EMAIL`.
4. **`linkAccount` refuses to move an identity to a different user.** It throws a
   distinct error the UI renders as "already linked to another account".
5. **The same helper backs every path:** the NextAuth `signIn` callback and adapter, all
   four mobile routes and SSO. The five copies are deleted.

### 6.4 SSO

- **v1, deployment-level OIDC.** One IdP per deployment, from env: Okta, Entra ID,
  Google Workspace, any OIDC issuer. This covers a single-customer white label.
- **v2, per-org SSO for the multi-org service (D1).**
  - **Data:** an `SsoConnection` table holding `{ workspaceId?, protocol: oidc|saml,
    domains[] (DNS TXT-verified), required: boolean, brokerRef }`.
  - **Sign-in flow:** the sign-in page offers "Continue with SSO", asks for a work
    email, looks up the domain, and redirects to that connection.
  - **Enforcement:** `required` blocks other providers for that domain.
  - **SAML via a broker, never hand-rolled.** Signature, audience, replay and clock skew
    are vetted code. **Recommendation:** embed BoxyHQ SAML Jackson
    (`@boxyhq/saml-jackson`, OSS). It presents SAML IdPs to Astrid as OIDC, so the app
    speaks exactly one protocol and the vendor stays swappable in the spirit of
    WHITELABELING's service-provider section. WorkOS is the hosted alternative.
- **GitHub-org SAML interplay (GitHub brand).** When an org enforces SAML, a GitHub user
  token works only while the user has an active SAML session for that org. GitHub answers
  `403` with `X-GitHub-SSO: required; url=…`. The client maps that onto a typed error that
  renders "Authorize \<org\> SSO" with that URL. It is never shown as a generic forbidden.

### 6.5 Native apps and sessions

- **Native-token providers** (Apple, Google on iOS) keep their routes. The routes
  delegate to §6.3.
- **Browser-based providers** (GitHub, SSO, and Google on Mac) use the existing desktop
  hand-off: `ASWebAuthenticationSession` → `/auth/desktop?provider=github` → PKCE grant
  → `/api/v1/auth/desktop/exchange`. Windows already uses it. **No GitHub or SAML SDK
  ships in the native apps.**
- **One session format.** The mobile DB-session routes move to the JWT format that
  passkey and desktop already use. `mobile-session` keeps accepting old DB sessions until
  they expire (30 days), then the fallback is deleted. Sessions SSO deprovisioning must
  revoke can be killed via a per-user `sessionEpoch` claim, checked in the `jwt`
  callback.
- **`GET /api/v1/capabilities`** adds
  `auth.providers: [{ id, kind, label, iconKey }]` in configured order. It keeps the
  legacy booleans for old clients.
- **The web sign-in page** renders from that list with the existing
  `auth.continueWith {provider}` i18n key. The hard-coded English and the unused
  `getProviders()` call go away.
- **Hard-coded identities** (Google client id, Apple bundle ids, the astrid.cc preview
  bounce) move to the brand profile.

---

## 7. W3: one GitHub connection

### 7.1 Today: three stacks

| | Stack 1: Issues sync | Stack 2: coding agent | Stack 3: Copilot |
|---|---|---|---|
| Credential | OAuth App, scope `repo`, token never expires | GitHub App, installation tokens only (no client id, so no user tokens) | OAuth / App user token, refreshing |
| Store | `Integration[GITHUB_ISSUES]` | `GitHubIntegration` (per user and installation; `repositories` JSON; dead `appId`/`privateKey`/`webhookSecret`) | `CopilotCredential` |
| Client | raw `fetch` in `lib/sync/github.ts` | Octokit `App` in `lib/github-client.ts`, plus 4 more inline `new App` | `lib/copilot/oauth.ts` |
| Webhook | `/api/webhooks/github-issues`, manual per repo, nudge only | `/api/github/webhooks` | — |
| UI | List settings → Admin → External sync | Settings → Agents → GitHub connection, `agents/github-setup`, list AI-agent repo picker | Agent hub row |
| Gate | `syncGithubIssues` | **`syncGithubIssues`** (B5) | `copilotIntegrationGate` |

Further defects in stack 2:
- `forUser` reads only the user's first installation.
- Repos added by refresh or webhook don't record their installation.
- `getInstallationIdForRepo` falls back to the default installation, which may be the
  wrong org.

### 7.2 Target

**One GitHub App per brand.** It provides sign-in (when `github` is in the provider
list), Issues sync, Projects sync (GitHub brand only) and the coding agent. **Copilot
stays separate:** it authorises a different product, and folding it in would put Copilot
consent and org policy on every sign-in.

```prisma
/// One row per App installation (org or user). Replaces GitHubIntegration.
/// Access is never "claimed": it is derived from GitHub (§7.3).
model GitHubInstallation {
  id                  BigInt   @id              // GitHub installation id
  accountNodeId       String   @unique          // O_… / U_…, stable across renames
  accountLogin        String
  accountType         String                    // Organization | User
  repositorySelection String                    // all | selected
  suspendedAt         DateTime?
  repos               GitHubInstallationRepo[]
  access              GitHubInstallationAccess[]
}

model GitHubInstallationRepo {
  repoNodeId     String @id
  installationId BigInt
  fullName       String                         // owner/repo, display + legacy lookups
  @@index([installationId])
  @@index([fullName])
}

/// "This user can see this installation", refreshed from GET /user/installations.
model GitHubInstallationAccess {
  userId         String
  installationId BigInt
  refreshedAt    DateTime
  @@id([userId, installationId])
}
```

**As built ([AWTD-1111](https://astrid.cc/t/AWTD-1111)), three deliberate differences from
the sketch above:**
- Installation ids are `Int`, matching `GitHubIntegration.installationId`. Widen both
  together if GitHub's ids ever approach 2³¹.
- `GitHubInstallationRepo` is keyed by GitHub's **numeric** repo id (`repoId BigInt`).
  `nodeId` is optional and unique: the links being migrated never stored node ids.
  `accountNodeId` is nullable for the same reason, and is filled on the next refresh.
- Access rows carry `source`: `verified` (the setup route, after GitHub listed the
  installation for the user's own token) or `legacy` (the migration's backfill from the
  links in force before it, which grants nothing new).

The one writer is `lib/github/installations.ts`. The installation webhooks live in
`lib/github/webhooks/installation.ts` and never grant access.

- **User-to-server tokens** live in the existing encrypted `Integration` store under a
  new provider value, `GITHUB`: access token (8h), refresh token (6 months), expiries and
  `externalAccountId = numeric GitHub id`. Sign-in creates the NextAuth `Account`
  (identity only, tokens stripped) **and** upserts this row, so there is **one** GitHub
  token store.
- **One client module, `lib/github/`:**

  | File | Role |
  |---|---|
  | `host.ts` | `GITHUB_API_URL` / `GITHUB_WEB_URL`, for GHE.com and later GHES |
  | `app.ts` | The single `App` instance |
  | `client.ts` | `forUser(userId)` refreshes on expiry and **never** falls back to an installation token; `forInstallation(id)` |
  | `rate-limiter.ts` | §8.8 |
  | `webhooks/` | One endpoint, one router per event, dedupe on `X-GitHub-Delivery` |

  Rule tests ban `new App(` and literal `api.github.com` outside `lib/github/`.

### 7.3 Access is derived, never claimed (fixes S1 by construction)

A user may act on an installation only if `GitHubInstallationAccess` has the row. That
row is written only from that user's own `GET /user/installations`:
- at sign-in or connect
- on the `installation` webhook
- every 6h

The installation picker, `connect-installation` and `manual-setup` disappear. The
`setup` callback becomes "refresh my access" and needs no trust in its query string.

### 7.4 Migration (astrid.cc and existing brands)

| Step | Detail |
|---|---|
| Dual-read | `githubTokenFor` tries `Integration[GITHUB]` first, then `[GITHUB_ISSUES]`. The cron and proxy keep working for users who haven't reconnected. |
| Pre-flight report | A script lists each `ExternalListLink.remoteContainerId` not covered by any installation the owner can see. Those links will 404 after migration. **This is the one real convenience cost:** a `repo`-scoped OAuth token reaches every repo, while an App reaches only repos where it is installed. The UI shows an "Install on \<owner\>" call to action per uncovered repo. |
| Re-point links | `ExternalListLink.integrationId` / `ExternalTaskLink` move to the new row in a transaction. **Never delete the old row:** delete cascades to every link and watermark. Revoke it (null the token), then call GitHub's delete-grant API. |
| Webhooks | The App webhook gains `issues` and `issue_comment`, keeping the SSE payload `{provider:'GITHUB_ISSUES', container}` iOS consumes. Retire `/api/webhooks/github-issues` only after that ships. |
| Existing installations | Copy `GitHubIntegration` → `GitHubInstallation` and populate `GitHubInstallationRepo` from the API. A user's access is re-derived on their next sign-in or connect. Nobody keeps an installation they cannot prove. |
| iOS | Unchanged if the `/api/v1/sync/github/*` paths and shapes stay and `GITHUB_ISSUES` stays as a response alias. One addition: render the install call to action from a new `installUrl` field on repo-not-installed errors. |
| UI | One **Settings → Connections → GitHub** card: account, installations with repo counts, "Install on another org", disconnect. List-admin sync and the agent repo picker both read the installation's repos, so the iOS "use the sync repo" bridge becomes unnecessary. |

### 7.5 Capabilities after the split

| Capability | Gates | Default |
|---|---|---|
| `githubConnection` | The App exists: the connection card, `lib/github/*` routes, the webhook endpoint | on (Astrid has an App) |
| `syncGithubIssues` | Repo-level Issues sync | on |
| `codingAgent` (new) | The coding workflow and its webhook events (fixes B5) | on |
| `githubProjects` (new) | Everything in §8–§11 | **off, and pinned off for Astrid (D5)** |
| `authGithub` | Via the provider registry (§6.2) | off |

Boot assertions:
- Any GitHub capability on → `GITHUB_APP_ID`/`PRIVATE_KEY`/`WEBHOOK_SECRET` present.
- `authGithub` or `githubProjects` on → the App client id and secret present.
- `githubProjects` on → `projectMode` on.

---

## 8. W4: the GitHub Projects backend

### 8.1 Tenancy: a service for many orgs (D1)

- **Workspace = `GitHubInstallation`** of type Organization. Every GitHub-backed
  `Project` carries `githubInstallationId`. User-owned projects are out of v1, because
  GitHub sends them no Projects webhooks.
- **One Astrid user can belong to many workspaces.** Visibility comes from
  `GitHubInstallationAccess` plus GitHub project permissions (§8.6).
- **Isolation, enforced in code:**
  - Every GitHub-backed query filters through the user's materialised `ListMember` rows,
    the existing permission joins, so no new tenancy predicate is threaded through reads.
  - Every *background* operation is keyed by installation: jobs, rate buckets, tokens.
  - **Fairness:** the job drainer runs round-robin by installation, with per-installation
    concurrency 2, so one large org cannot starve others.
- **Uninstall.** `installation.deleted` makes the workspace's lists read-only at once,
  then purges replica rows after a 30-day grace (a scheduled job). Personal lists and
  Astrid-only data stay with the user. `installation.suspend` → read-only.
- **No cross-org identifiers.** GitHub-backed projects mint no `Project.key`, so the
  global unique key index is untouched.

### 8.2 Personal lists (D2)

Personal Astrid lists keep working on the GitHub brand: My Day, reminders, private to-dos.
A GitHub issue may also be added to a personal list. That membership is local, invisible
on GitHub, and survives the issue leaving its project. Personal lists are on by default.
`BRAND_ALLOW_LOCAL_LISTS=false` removes them for a brand that wants a pure GitHub client.

### 8.3 Never on astrid.cc (D5)

- `githubProjects` defaults **off**, and `brands/astrid.brand.json` sets nothing.
- The brand matrix asserts the Astrid profile has `githubProjects: false`, and that every
  §11 route answers 404 under it.
- A rule test asserts `brands/astrid.brand.json` never enables
  `NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS`. That makes D5 a failing build, not a
  convention.
- Astrid keeps the repo-level **Issues sync**, now on the single App (§7).

### 8.4 Concept map

| GitHub | Astrid |
|---|---|
| `ProjectV2` (org) | `Project` (board, `key = null`) plus its primary `TaskList` (`backend = 'github_project'`) |
| `ProjectV2Item` | Membership of a `Task` in that list (`GitHubProjectItem`) |
| Issue / DraftIssue / PullRequest content | `Task`, keyed by **content node id**, which is stable across transfers, unlike `owner/repo#N` |
| One issue in N projects | One `Task` in N lists (the existing many-to-many) |
| **Status** single-select | `statusRole` + `customStates` (§9.2) |
| Done option, or `state: closed` | `completed` + `closedReason` |
| Priority single-select / designated Date / "Estimate" number | `priority` 0–3 / `dueDateTime` (all-day) / `estimate` |
| Every other field: text, number, date, single-select, iteration | **Project fields, read/write** (§9.4) |
| Iteration | A project field, plus a virtual list per iteration (PROJECT_MODE's "cycle") |
| Labels (repo-scoped) | Label-flavor lists (`listType: 'label'`), one per `(repo, label)` |
| Milestone | A read-only chip plus a virtual list |
| Assignees (≤10) | `assigneeId` (primary) + `assigneeIds[]` (§9.5) |
| Sub-issues / issue dependencies | `parentTaskId` / `TaskDependency` (inbound cycles accepted; Astrid's 409 applies to Astrid writes only) |
| Issue comments | `Comment`. Drafts have none, so the composer is disabled with a reason. |
| Item position | `manualSortOrder` ↔ `updateProjectV2ItemPosition` |
| Project and org permissions | Materialised `ListMember` roles (§8.6) |
| GitHub user | `User.githubUserId` (numeric), never the login |
| App bot | The author for AI-agent writes (§8.6) |

### 8.5 Data model additions (all additive and nullable)

```prisma
model GitHubProjectBinding {
  projectId          String  @id                // Astrid Project
  installationId     BigInt
  projectNodeId      String  @unique            // PVT_…
  number             Int
  statusFieldId      String?
  statusOptionMap    Json                       // { optionId: statusRole | "done" }
  priorityFieldId    String?
  priorityOptionMap  Json?                      // { optionId: 0..3 }
  dueFieldId         String?
  estimateFieldId    String?
  defaultRepoNodeId  String?                    // "New task" creates an issue here; null = draft
  lastReconciledAt   DateTime?
  @@index([installationId])
}

model GitHubProjectItem {
  itemNodeId String  @id                        // PVTI_…
  projectId  String
  taskId     String
  archived   Boolean @default(false)
  @@unique([projectId, taskId])
  @@index([taskId])
}

/// Durable, idempotent sync work (G8). Drained inline via waitUntil and by the
/// per-minute cron; round-robin by installation (§8.1).
model GitHubSyncJob {
  id             String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  dedupeKey      String    @unique              // delivery id | item:<node>:<2s bucket> | recur:<task>:<n> | reconcile:<project>:<window>
  kind           String                         // webhook | hydrate | reconcile | writeback | recur | access
  installationId BigInt
  payload        Json
  attempts       Int       @default(0)
  runAfter       DateTime  @default(now())
  lockedUntil    DateTime?
  doneAt         DateTime?
  error          String?
  @@index([doneAt, runAfter, installationId])
}
```

Project fields are in §9.4.

| Table | New column | Purpose |
|---|---|---|
| `Project` | `githubInstallationId BigInt?` | Tenancy (§8.1) |
| `TaskList` | `backend String?` | The one switch the seam reads |
| `Task` | `remoteNodeId String? @unique`, `remoteKind String?`, `remoteVersion String?` | Identity and the body-conflict base |
| `Task` | `assigneeIds String[]` | §9.5 |
| `Task` | `previousOccurrenceId String?` (indexed) | §10 |
| `User` | `githubUserId BigInt? @unique` | Identity link |

`Task.identifier` holds `owner/repo#N` for issues and PRs. That value is globally unique
by construction. Transfers record an alias.

### 8.6 Credentials and permissions

| Action | Credential | Why |
|---|---|---|
| A user edits in Astrid | **That user's** user-to-server token | GitHub attributes the edit and enforces the user's own permissions, so Astrid does not re-implement GitHub's permission model |
| Hydration, reconcile, access refresh | Installation token | No user is involved |
| An AI agent comments or moves a card | Installation token (App bot), body prefixed "**\<Agent\>** (via \<Brand\>)" | Agents aren't GitHub users |
| Assigning an agent | No GitHub assignee. Stored in the replica, and mirrored as label `agent:<name>` when `BRAND_GITHUB_AGENT_LABELS` (default on) | github.com users can see who's working it |

**User-token refresh failure** makes the user's GitHub lists read-only, with
`auth_required`. **No fallback to the installation token**, pinned by a rule test.

**Roles.** These are materialised from GitHub at sign-in and every 6h, using the user's
token to list visible org projects:
- project admin or org owner → **admin**
- write → **member**
- read → **viewer**

A GitHub 403/404 on write triggers an immediate refresh for that user and project.
Invite, leave, transfer and change-role are hidden and return 404 on GitHub-backed lists.
PRODUCT_CONTRACT's matrix still applies, unchanged, over the derived roles.

**GitHub App permissions:**
- Organization projects: read/write
- Issues: read/write
- Pull requests: read (write for `codingAgent`)
- Contents: write (`codingAgent` only)
- Metadata: read
- Members: read
- Email addresses: read

**Webhook events:**
- `installation*`
- `projects_v2`, `projects_v2_item`
- `issues`, `issue_comment`, `sub_issues`
- `label`, `milestone`, `pull_request`
- `member`, `membership`, `organization`
- Issue dependencies are covered by reconcile where no event exists.

### 8.7 Sync engine

```
GitHub ─webhook─▶ lib/github/webhooks  verify HMAC → dedupe → INSERT GitHubSyncJob → 202
                                                     │
                     per-minute cron + waitUntil ────┤ round-robin by installation
                                                     ▼
                      hydrate (one GraphQL query, fixed fragment, installation token)
                                                     ▼
                      apply(normalised remote) → prisma txn → TaskEvent / SSE / DeletionLog
                                                     ▲
                      reconcile (per project, budgeted) ┘    redeliver failed deliveries (hourly)
```

- **The payload is a trigger, never data.** `projects_v2_item` carries ids, not values,
  so every event hydrates current state. Out-of-order delivery is therefore harmless.
- **Coalescing.** The dedupe key `item:<nodeId>:<2s bucket>` collapses a burst of field
  edits on one item into one hydration.
- **Apply compares values, not timestamps.** Only fields whose normalised remote value
  differs from the replica are written. TaskEvents and SSE are emitted only for those.
  An echo of Astrid's own write is a no-op by construction. **The replica always
  converges to GitHub.**
- **Body conflicts.** A body edit whose base `remoteVersion` is stale returns `conflict`
  rather than overwriting someone's paragraph. Other fields are last-write-to-GitHub-wins,
  as on github.com.
- **Deletions.**

  | Event | Effect |
  |---|---|
  | `projects_v2_item.deleted` or `.archived` | Leaves that list (`DeletionLog` for the membership) |
  | `issues.deleted` | Task deleted |
  | Item missing from two consecutive full reconciles | Removed |

  An Astrid "delete" on a GitHub board means **remove from project**. Deleting the issue
  needs explicit confirmation and repo admin rights.
- **Partial failure.** A create is `createIssue` (or `addProjectV2DraftIssue`), then
  `addProjectV2ItemById`, then field updates, sent as one GraphQL document with aliased
  mutations. If the content exists but a later step fails, the task lands with
  `syncState: 'pending'`, and the remainder is enqueued as `writeback` jobs.
- **Offline idempotency.** The `Task` row with its `clientRequestId` (existing unique
  index) is inserted *before* the GitHub call. A replay finds it and either returns the
  existing `remoteNodeId` or finishes the create.
- **Status ↔ closed.**
  - Moving to the Done option **also closes** an open issue (`completed`).
  - Closing on github.com renders the task completed. Astrid **does not** write Status
    back, and leaves GitHub's built-in project workflow to move the card. **Astrid never
    fights a GitHub workflow.**

### 8.8 Rate limits and GitHub hosts

`lib/github/rate-limiter.ts` is the only HTTP path. It wraps Octokit's throttling and
retry plugins with a Redis token bucket.

- **Buckets:** per user token, and per installation.
- **Limits honoured:**
  - `x-ratelimit-remaining` / `-reset`
  - GraphQL `rateLimit { cost remaining }`, requested on every query
  - secondary-limit `retry-after` and the content-creation caps
- **Priority:** user-facing writes go first, then hydrations, then reconcile.
  **Reconcile may use at most 30% of an installation's hourly budget**, and its interval
  adapts to fit.
- **Timeouts:** 15s on every call.
- **Hosts:** `GITHUB_API_URL` and `GITHUB_WEB_URL` (§7.2) keep GHE.com data-residency
  tenants a configuration change.

---

## 9. Field semantics

### 9.1 Ownership

| Owned by GitHub (write-through) | Owned by Astrid (replica only, never sent) |
|---|---|
| Title, body, open/closed and reason, Status, Priority, due, estimate, assignees, labels, milestone, parent, dependencies, comments, position, project membership, **all project field values** | Reminders, recurrence configuration (§10), favourites, per-user view preferences, personal-list membership, cost, timers, agent-assignment metadata. `isPrivate` is disabled on GitHub boards. |

### 9.2 Status and Priority

- **Status.** The bind wizard proposes a mapping, which the user confirms:

  | GitHub option | Astrid |
  |---|---|
  | `Todo` | `ready` |
  | `In Progress` | `doing` |
  | `Done` | completed |
  | `Blocked` / `Waiting` | `waiting` |
  | anything else | a custom state `gh:<optionId>` |

  No new board code is needed.
- **Priority** options map in order onto 3, 2, 1, 0. With no Priority field,
  `supports.priority = false`.

### 9.3 Identifiers

- `owner/repo#N`, shown as `repo#N`. Transfers keep resolving through an alias.
- **Drafts** have none until converted. The node id persists, so the task id is
  unchanged.
- Astrid task links resolve by task id. `remote.url` links to GitHub.

### 9.4 Project fields, read and write (D4, amends PROJECT_MODE.md:146)

PROJECT_MODE excludes "arbitrary user-defined custom fields". The amendment is scoped:

> **On a GitHub-backed board, every project field is shown and editable in the task
> detail pane, and filterable on the board.** Fields are defined in GitHub. Astrid adds
> no way to *create* fields, and local boards never grow them. Nothing renders on any
> other list.

#### 9.4.1 Model

Backend-neutral by name, populated only by GitHub bindings:

```prisma
model ProjectField {
  id          String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  projectId   String
  remoteId    String                    // PVTF_… / PVTSSF_… / PVTIF_…
  name        String
  dataType    String                    // text | number | date | single_select | iteration
  options     Json?                     // single_select: [{id,name,color,description}]
  iterations  Json?                     // iteration: [{id,title,startDate,duration}], completed included
  mappedTo    String?                   // status | priority | due | estimate → native column, not stored below
  position    Int
  updatedAt   DateTime @updatedAt
  @@unique([projectId, remoteId])
}

/// Values live per (task, field). A field belongs to one project, and an issue in
/// two projects has two items with independent values.
model TaskFieldValue {
  taskId      String
  fieldId     String                    // ProjectField.id
  projectId   String                    // denormalised for the delta query
  text        String?
  number      Float?
  date        DateTime? @db.Date
  optionId    String?
  iterationId String?
  updatedAt   DateTime  @updatedAt
  @@id([taskId, fieldId])
  @@index([projectId, updatedAt])
}
```

Mapped fields (Status, Priority, due, estimate) stay in native `Task` columns and are
never duplicated here, so there is one source per value.

#### 9.4.2 Writes

`PUT /api/v1/tasks/{id}/fields/{fieldId}` with body `{ "value": <typed> | null }` →
`TaskBackend.setFieldValue` → `updateProjectV2ItemFieldValue` or
`clearProjectV2ItemFieldValue` → apply.

- **Validated against the schema:** the option or iteration exists, and the type
  matches.
- **Permission:** list write role.
- **One field per request,** so concurrent edits of different fields never conflict.
- **Schema drift.** GitHub sends no event for field definitions. An unknown field or
  option id seen during hydration, plus every reconcile, refreshes the project's
  `ProjectField` rows.

#### 9.4.3 Payload budget (G15)

The full task response is at 88% of 500 KiB on the wire, so values **must not** ride on
every task in the obvious shape. The design:

- **Schema once per project.** `GET /api/v1/projects/{id}/fields` returns it, cached by
  ETag.
- **Compact values.** On tasks the shape is `"fields": { "<fieldId>": <scalar | optionId
  | iterationId> }`. No names, no types, no nulls, and present only on tasks in
  GitHub-backed lists.
- **Delta sync.** A value change bumps `Task.updatedAt`, so values ride the existing
  `?updatedSince=` delta with no new sync channel.
- **Gate.** `scripts/measure-api-latency.ts` gains a GitHub-board fixture: 1,000 tasks,
  8 fields. If the full response exceeds 500 KiB on the wire, values move behind
  `?include=fields` for list views and load per task in detail. **The budget wins over
  convenience.**

### 9.5 Multiple assignees

- **New field:** `assigneeIds: string[]` (additive). `assigneeId` is always
  `assigneeIds[0]`.
- **Old clients** setting `assigneeId` replace only the first entry and never silently
  unassign others.
- **Classic lists** keep at most one assignee.

---

## 10. Recurrence on GitHub boards: spawn the next issue (D3)

### 10.1 Today vs the new mode

**Today**, completing a repeating task **rolls the same row forward**: `completed:
false`, next due date, `occurrenceCount + 1` (`lib/repeating-task-handler.ts:154`). iOS
and Mac run the same astrid-core rule on the device. That is right for personal lists,
and it stays.

**On GitHub-backed lists** the mode is **spawn**. The completed issue stays closed as
history, and the next occurrence is a **new issue linked to it**:

| Step | Detail |
|---|---|
| Trigger | The task completes, from Astrid **or** `issues.closed` (reason `completed`) on github.com, and `repeating ≠ never` and the series has not terminated. A close as "not planned" ends the series (closed reason → no spawn), matching today's closed-reason rule. |
| Arithmetic | astrid-core `nextOccurrence`, unchanged (both `DUE_DATE` and `COMPLETION_DATE` modes, time-zone rules as today) |
| Create | A new issue in the **same repo**. Drafts spawn drafts. Copies: title, body, labels, assignees, milestone. Body footer: `Previous occurrence: owner/repo#N`. |
| Projects | Added to **every project** the predecessor was in. Copies all project field values except Status, which resets to the binding's first non-done state (normally `ready`). The due field is set to the next date. |
| Link | New `Task.previousOccurrenceId = predecessor.id`, and the recurrence configuration moves to the new task with `occurrenceCount + 1`. A comment on the predecessor, `Next occurrence: #M`, gives a GitHub timeline cross-reference both ways. |
| Predecessor | Stays completed. Its recurrence configuration is cleared: it is history. |
| Exactly once | Spawning is a `recur` job with dedupe key `recur:<taskId>:<occurrenceCount>`. An Astrid completion and the resulting webhook race to the same key, so one issue is created. |
| Reopen | Reopening a predecessor does not delete the spawned issue. The series lives on the newest occurrence. |
| Termination | Count or until reached → no spawn. The predecessor completes, which needs B3 fixed for the local mode too. |

### 10.2 Clients

`list.supports.repeatMode: 'roll_forward' | 'spawn'`. In `spawn` mode, iOS and web send
the completion and **do not** roll forward locally. The spawned task arrives by SSE or
delta. The detail pane shows "Previous occurrence" and "Next occurrence" links from
`previousOccurrenceId`.

---

## 11. API and client contract

### 11.1 Brand profile (GitHub brand)

`brands/github-projects.brand.json` is **Lanes for GitHub Projects**, a generic Graceful
Tools brand at `projects.gracefultools.com` (AWTD-1103). Its GitHub App slug,
`lanes-for-github-projects`, is a placeholder until that App is registered, and
`NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS` joins the profile when P4 builds it.

```json
"NEXT_PUBLIC_BRAND_AUTH_PROVIDERS": "github,sso",
"NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS": "true",
"NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE": "true",
"NEXT_PUBLIC_BRAND_ENABLE_SYNC_GITHUB_ISSUES": "false",
"NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS": "false",
"NEXT_PUBLIC_BRAND_ENABLE_TASK_COST": "false"
```

**Trademark.** "\<Brand\> for GitHub Projects" is the descriptive form GitHub's brand
guidelines allow. `check:brands` rejects a `NEXT_PUBLIC_BRAND_NAME` matching
`/^git ?hub/i`.

### 11.2 Additive v1 fields

All additive, as API_CONTRACT permits.

**List**

```jsonc
"backend": "github_project" | null,
"remote": { "url": "…", "owner": "acme", "number": 12 } | null,
"supports": {                                   // every key at its classic value on local lists
  "repeatMode": "spawn", "privateTasks": false, "membership": false,
  "priority": true, "dueDate": true, "comments": true, "multipleAssignees": true,
  "fields": true, "deleteTask": "remove_from_list"
}
```

**Task**

```jsonc
"assigneeIds": ["…"],
"remote": { "kind": "issue", "url": "…", "nodeId": "I_…", "version": "…" } | null,
"fields": { "<fieldId>": "<value>" },           // GitHub-backed lists only (§9.4.3)
"previousOccurrenceId": "…" | null,
"syncState": "synced" | "pending" | "error"
```

**`GET /api/v1/capabilities`** adds `auth.providers[]` (§6.5) and `githubProjects`.

**New routes**, all `withAuth({ capability: 'githubProjects' })`:

| Route | Purpose |
|---|---|
| `GET /api/v1/github/projects` | Bindable projects across the user's installations |
| `POST /api/v1/github/projects/{nodeId}/bind` | Creates the Project, list, binding and fields |
| `GET/PATCH /api/v1/github/projects/{projectId}/binding` | Edit the field mapping |
| `DELETE /api/v1/github/projects/{projectId}/binding` | Unbind; keeps a read-only local snapshot |
| `GET /api/v1/projects/{id}/fields` | Field schema, cached by ETag |
| `PUT /api/v1/tasks/{id}/fields/{fieldId}` | Set or clear a field value |

**Errors map onto existing v1 codes:**

| GitHub | v1 error |
|---|---|
| 401 or refresh failure | `auth_required` |
| 403 or 404 (after a membership refresh) | `forbidden` |
| 403 with `X-GitHub-SSO` | `sso_required` (new, additive, carries the URL) |
| 409 or a stale body base | `conflict` |
| Secondary limit | `rate_limited` + `retryAfter` |
| 5xx | `upstream_unavailable` (new, additive) |

### 11.3 Clients

- **Web.** `supports.*` gating, a fields section with typed editors (text, number, date,
  single-select, iteration), a `repo#N` chip, a pending-sync indicator, multiple
  assignees, occurrence links, provider-driven sign-in. **No change** to the data layer,
  cache, offline queue or SSE.
- **iOS/Mac.**
  - The provider list from capabilities, with default-off decoding (§6.2).
  - GitHub and SSO via the desktop hand-off.
  - `supports` gating, field editors, `repeatMode: 'spawn'`.
  - **Disable the on-device Issues engine on GitHub-backed lists.**
- **Windows.** Replays PRODUCT_CONTRACT fixtures, which gain a GitHub-backed list.
- **MCP and agents.** No new tools. Everything routes through the seam (§5.3).

---

## 12. W5: brand and partner delivery

1. Add `brands/github-projects.brand.json` and artwork, run `check:brands`, deploy a
   preview with `scripts/deploy-brand-preview.ts`.
2. Register the GitHub App (permissions and events in §8.6) and publish its Marketplace
   listing.
3. Run a copy pass for "board/project" wording through i18n. No literals: `check:reuse`
   enforces this.
4. Add a WHITELABELING §3 table for the provider registry and the new capabilities, and a
   §8 checklist for a GitHub partner.
5. Native apps: apply the profile via `scripts/apply-brand.sh`, and pass the
   `BrandAuditTests` under the partner profile.

---

## 13. Engineering standards for this work

### 13.1 Red-green TDD, always

- **Every behavioural change starts with a failing test that names the task id.** The
  PR description shows the red run. Bug fixes follow ASTRID.md exactly: RED regression →
  green → `npm run predeploy`. Auth changes (W2, and S2 in W3) run the full suite before
  committing.
- **Prefer behavioural tests against the contract-test database over Prisma mocks for
  any query shape.** B1 shipped *because* a mock asserted the broken `where`. Mocks are
  fine for orchestration. They are not evidence that a query works.
- **Every new rule test plants a violation** and proves it fires before it lands, per
  WHITELABELING §9's warning about malformed greps that stay green.

### 13.2 Clean code

| Concern | One home | Enforced by |
|---|---|---|
| Entity writes | `services/` | `entity-writes-go-through-services` ratchet (§5.1) |
| Completion | `resolveCompletionFields` via the update service | `no completed:true outside services` rule |
| Agent dispatch on assign | `task-assignment-notifier.ts` | `$extends` deleted; rule forbids raw `assigneeId` writes |
| Sign-in | `lib/auth/sign-in-with-verified-identity.ts` | Rule: no `prisma.account.create` / `user.create` outside it |
| Login providers | `lib/auth/providers/` registry | Brand matrix asserts every listed provider has its env |
| GitHub HTTP | `lib/github/` | Rules: no `new App(`, no raw `api.github.com`, no `fetch('https://api.github` outside it |
| Remote-first writes | `TaskBackend` | Fake-backend run of the service suite |
| Brand literals | `lib/brand/*` | `check:reuse` |

Further rules:
- **Delete what is replaced, in the same PR:** the five sign-in copies, five `new App`
  instances, `GitHubIntegration`'s dead columns, `/api/webhooks/github-issues` (after
  cut-over), `lib/database-utils.ts:198`, and the third leave implementation. A
  consolidation that leaves the old path alive has not consolidated anything.
- **Apply is a pure function**, `normalise(remote) → diff(replica) → patch`. That makes
  it testable without network access or a database, and keeps GitHub's shapes out of
  Astrid's core.

### 13.3 Performance budgets

New rows go into PERFORMANCE_BUDGETS.md, each with its source, per that document's rule.

| Metric | Budget | Source |
|---|---|---|
| Webhook ack | p95 ≤ 300 ms (verify + insert job only) | Route timing test plus `vercel logs` |
| Webhook → replica (edit on github.com visible in Astrid) | p95 ≤ 10 s | Synthetic probe job in the test org |
| GitHub-backed write (Astrid → GitHub → replica) | p95 ≤ 1.5 s server-side. The UI stays optimistic, so perceived latency is unchanged. | `scripts/measure-api-latency.ts` GitHub fixture |
| Full task response with fields | ≤ 500 KiB on the wire (existing budget, not raised) | Same, 1,000 tasks × 8 fields fixture |
| Reconcile share | ≤ 30% of installation GraphQL budget per hour | Rate-limiter metrics |
| Apply DB work | ≤ 4 queries per item event | Contract test pins the query count, like the existing Prisma row |
| Initial import | 2,000-item project ≤ 5 min | Live smoke test |

Implementation rules that keep these budgets:
- Batch upserts per 100-item page.
- No N+1 in apply.
- Hydration uses one fixed GraphQL fragment.
- Coalesce bursts (§8.7).
- Serve the field schema with an ETag.

---

## 14. Delivery plan

Every phase ships behind capabilities that are off by default. astrid.cc changes only
through W1 and W3's bug fixes and simplifications, which are behaviour-preserving apart
from the fixes themselves. Sizes: S = days, M = 1–2 weeks, L = 3+ weeks.

| Phase | Scope | Size | Exit: tests that went red, then green |
|---|---|---|---|
| **P0 Defects** | S1, S2, S3, B1–B5 (§2) | S–M | One regression test each, listed in §2. B1's test runs against the contract DB. |
| **P1 Write path** (W1) | §5.2 steps 2–8 | M–L | The ratchet at its final allow-list. The fake-backend suite passes. Zero behaviour change beyond P0's fixes. |
| **P2 Login registry** (W2) | §6. Can run in parallel with P1. | M | Brand matrix: each provider combination boots with its env and refuses without it. Linking rules (verified-only, domain-bound, never re-home, never agent or admin). Legacy flags still produce Astrid's exact provider set. |
| **P3 One GitHub connection** (W3) | §7 plus the migration | M | Access derived only from `/user/installations`. Dual-read cron. iOS contract unchanged (fixtures). Pre-flight report run against prod read-only. Capability split asserted in the matrix. |
| **P4 Projects: read-only mirror** | §8.1, §8.3–§8.8; bind wizard, import, webhooks, reconcile, roles, uninstall | L | Hydration and apply are pure-function tests per item kind and webhook action, from recorded fixtures. A killed webhook is healed by reconcile. Fairness across two installations. |
| **P5 Projects: write-through** | Create, title, body, status with done-closes, assignees, comments, position, remove, idempotency, partial failure | L | Every write attributed to the acting user. Outbox replayed twice → one issue. Refresh failure → read-only, never installation-token writes. |
| **P6 Fields and recurrence** | §9.4 read/write, §9.5, labels, iterations, milestones, sub-issues, dependencies, PR items, §10 spawn | M–L | Each field type's round trip. Payload fixture inside budget. Webhook + Astrid completion race → exactly one spawned issue. |
| **P7 Per-org SSO** | §6.4 v2: `SsoConnection`, domain verification, SAML via Jackson | M | Domain-bound linking. `required` enforcement. SAML replay and audience tests from the broker's suite. |
| **P8 Brand and clients** | §11.3, §12 | M | `check:brands` green. The brand audit finds no Astrid literals. The Astrid profile still pins `githubProjects: false`. |

### 14.2 Test infrastructure introduced

- **`tests/fixtures/github/`:** recorded GraphQL and REST responses and webhook payloads
  for each item kind, field type and action. Octokit gets an injected `fetch` that
  replays them. No live network in unit tests.
- **`FakeTaskBackend`:** configurable to fail at any step, used to run the whole
  `*WithSideEffects` suite remote-first.
- **Live smoke test** against a dedicated test org, gated on a secret, outside
  predeploy.

---

## 15. Remaining open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | SAML broker: embedded BoxyHQ Jackson (OSS, self-hosted) or WorkOS (hosted, per-connection pricing)? | Jackson. It keeps the provider swappable and costs nothing per tenant. |
| Q2 | Accept the Issues-sync convenience cost on astrid.cc (the App reaches only installed repos)? | Yes. It is the price of fixing S1 and having one credential. The pre-flight report sizes it before cut-over. |
| Q3 | Mirror agent assignment as an `agent:<name>` label by default? | Yes, so github.com users can see it. Brands can turn it off. |
| Q4 | Pricing and Marketplace: free listing, or paid plans through GitHub Marketplace (`marketplace_purchase` events)? | Business decision. Technically, a paid listing adds one webhook handler and a plan column on `GitHubInstallation`. |

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| GitHub rate limits on large orgs | Write priority, the 30% reconcile cap, coalescing, adaptive intervals. Measured in P4 on a large real project before committing to P5. |
| GitHub API drift (Projects REST is newer, Sept 2025) | GraphQL first; recorded fixtures catch shape changes in CI. |
| Edits look like "\<Brand\> did it" | User tokens only for user actions, pinned by a rule test. |
| Two engines editing one issue | Issues sync off on the GitHub brand; iOS's engine disabled per list. |
| Account takeover through new providers | §6.3 linking rules, written test-first, before any provider is added. |
| P1 touches many files | 8 small PRs, each red-green. The ratchet only tightens. The existing suite (~3,000 tests) guards behaviour. |
| Trademark | Descriptive naming only, linted. |

---

*Sources for GitHub platform facts (checked 2026-10-04):*
- [REST API for GitHub Projects (2025-09-11)](https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/)
- [Projects v2 webhooks: org webhooks and GitHub Apps only](https://github.com/orgs/community/discussions/17405)
- [Sub-issues REST API](https://docs.github.com/en/rest/issues/sub-issues)
- [Issue dependencies REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/issues/issue-dependencies)
- [Issues and Projects GA: sub-issues, issue types](https://github.com/orgs/community/discussions/154148)

---

## 17. Implementation status (2026-10-05)

All on `main`; nothing deployed. Each item was built red-green, with the regression or
rule test named.

### P0 — defects (§2): done

| # | Task | Commit | Test |
|---|---|---|---|
| S1 | [AWTD-1087](https://astrid.cc/t/AWTD-1087) | `be1ab035` | `tests/api/github-installation-claim.test.ts` |
| S2 | [AWTD-1088](https://astrid.cc/t/AWTD-1088) | `26d1ea4a` | `tests/lib/auth-google-web-linking.test.ts` |
| S3 | [AWTD-1089](https://astrid.cc/t/AWTD-1089) | `3075744c` | `tests/api/invitations-assignee-rule.test.ts` |
| B1 | [AWTD-1090](https://astrid.cc/t/AWTD-1090) | `fd990c65` | `tests/api/v1-project-statuses.test.ts`, Postgres tier |
| B2 | [AWTD-1091](https://astrid.cc/t/AWTD-1091) | `3aba1e1b` | `tests/api/v1-lists-members-userId.test.ts` |
| B3 | [AWTD-1092](https://astrid.cc/t/AWTD-1092) | `7493e7c9` | `tests/api/task-write-path-parity.test.ts` |
| B4 | [AWTD-1093](https://astrid.cc/t/AWTD-1093) | `b8fe5064` | `tests/rules/task-completion-goes-through-the-service.test.ts` |
| B5 | [AWTD-1094](https://astrid.cc/t/AWTD-1094) | `26a1a9d7` | `tests/rules/coding-agent-has-its-own-capability.test.ts` |

**Before the deploy that carries S1:**
- The GitHub App's Callback URL list must include `https://<domain>/api/github/setup`.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (the App's `Iv…` client) must be set in
  production. Without them, new installation links fail closed; existing links keep
  working.

**For the whitelabel-partner deployment:** set
`NEXT_PUBLIC_BRAND_ENABLE_CODING_AGENT=false` (B5), or its coding agent turns on.

### P1 — one write path (§5): done

| Step | Commit | What |
|---|---|---|
| 2 | `b8fe5064` | `services/complete-task.ts`; every completion goes through the service |
| 3 | `75ca42c5` | `services/agent-assignment-dispatch.ts`; the `$extends` hook is deleted from `lib/prisma.ts` |
| 4 | `9fb2a460` | `services/post-comment-as.ts`; agent/system comments go through the comment service; agent→agent loop guard |
| 5 | `0042441d` | email-to-task creates through the service; batch copy applies the assignee rule |
| 6 | `0bfdf842` | membership changes announce themselves (`announceListMember*`, `announceRosterChanges`); legacy leave delegates |
| 7 | `0bfdf842` | `tests/rules/entity-writes-go-through-services.test.ts`, with a reasoned allow-list and a slack check |
| 8 | `87b659ef` | `lib/backends/` `TaskBackend` seam (local only) in front of create/update/delete; fake-remote runs of the parity suites |

Behaviour changes worth knowing:
- The "🤖 starting" acknowledgement comment, previously posted only by the deleted hook on
  update, is gone.
- Assigning the default assistant to an existing task now notifies it. It used to notify
  nobody.

### P2 — login providers (§6): done for web

Commit `6cf7c53e`:
- `NEXT_PUBLIC_BRAND_AUTH_PROVIDERS`
- GitHub and deployment-level OIDC SSO
- `lib/auth/federated-identity-linking.ts`, one linking rule for Google, GitHub and SSO
- boot credential checks
- `auth.providers` on `/api/v1/capabilities`
- sign-in buttons
- WHITELABELING.md "Sign-in providers"

AWTD-1104: the four mobile token routes (`/api/auth/{apple,google}`,
`/api/v1/auth/{apple,google}`) now verify the provider token and hand off to
`lib/auth/native-sign-in.ts`:
- `signInWithVerifiedIdentity` applies the same linking rule.
- Each route issues the NextAuth JWT that passkey and desktop use, set as
  `next-auth.session-token`, and in production also as the `__Secure-` name.
- They no longer write `Session` rows. The cookie fallback
  (`lib/auth/session-cookie.ts`) still accepts old rows until they expire.

**Not done:**
- Deleting the database-session fallbacks (`lib/auth/session-cookie.ts`, `mobile-session`, and
  the ad-hoc `prisma.session` reads in sse, secure-files, ai-api-keys and signout) once the last
  pre-AWTD-1104 row has expired.
- The `sessionEpoch` revocation claim (§6.5), which waits on SSO deprovisioning (P7).
- Per-org SSO and SAML (§6.4 v2, P7).
- Native GitHub/SSO sign-in in astrid-ios, via the desktop hand-off. The web half is done
  ([AWTD-1105](https://astrid.cc/t/AWTD-1105)): `ios` and `mac` hand-off clients, and
  `/auth/desktop?provider=github|google|sso` starts that provider directly for a signed-out user.

### P3 — one GitHub connection (§7): partly done

Done:
- The capability split (`codingAgent`, B5).
- Installation access proven by `GET /user/installations` (S1).
- One App instance and one host module (`1c971f62`).
- `githubGraphQL` timed.

- **The installation model** ([AWTD-1111](https://astrid.cc/t/AWTD-1111)): the
  `GitHubInstallation` / `GitHubInstallationRepo` / `GitHubInstallationAccess` tables,
  backfilled from `GitHubIntegration` by their migration. The setup, refresh, webhook and
  disconnect paths dual-write them. The coding agent resolves a repo's installation
  across **all** the user's installations, so the first-installation-only bug is gone.
  The migration applies at the next approved deploy.

Not done, and why:
- **Retiring `GitHubIntegration`.** Status, the installations list and the integration
  route still read it. They move with the Connections card (P3d). Dropping the table, and
  its dead `appId`/`privateKey`/`webhookSecret` columns, is a destructive migration, so it
  takes two deploys (docs/CLI_OPERATIONS.md, AWTD-959).
- **User-to-server tokens in `Integration[GITHUB]` and the Issues-sync migration with
  dual-read.** These need the App's permissions extended (Issues, Email addresses) on
  GitHub, and the pre-flight report run against production.
- **One webhook endpoint for `issues`/`issue_comment`.** This needs the App subscribed to
  those events on GitHub.
- **The Connections → GitHub settings card.**

### P4–P8 — the Projects backend, fields, recurrence, per-org SSO, brand: not started

These need, in order:
1. A decision to apply the additive schema in §4/§8.5/§9.4.1 at a deploy.
2. The brand's GitHub App given Organization Projects read/write and the `projects_v2*`
   events.
3. A test org for the live smoke test (§14.2).
4. The astrid-ios work in §11.3.

The seam they plug into, `TaskBackend` (§5.3), is in place.

### Where the remaining work is tracked

Every remaining item is a task, written to stand on its own.

| Owner | Tasks |
|---|---|
| **Jon: before the next deploy** | [AWTD-1096](https://astrid.cc/t/AWTD-1096) GitHub App callback URLs + OAuth client in prod · [AWTD-1097](https://astrid.cc/t/AWTD-1097) whitelabel-partner `CODING_AGENT=false` · [AWTD-1098](https://astrid.cc/t/AWTD-1098) ship P0–P2 |
| **Jon: unblockers** | [AWTD-1099](https://astrid.cc/t/AWTD-1099) schema decision · [AWTD-1100](https://astrid.cc/t/AWTD-1100) App permissions/events · [AWTD-1101](https://astrid.cc/t/AWTD-1101) test org · [AWTD-1102](https://astrid.cc/t/AWTD-1102) §15 questions · [AWTD-1103](https://astrid.cc/t/AWTD-1103) partner brand |
| P2 remainder | [AWTD-1104](https://astrid.cc/t/AWTD-1104) mobile routes onto the shared rule · [AWTD-1110](https://astrid.cc/t/AWTD-1110) Apple on web · [AITD-465](https://astrid.cc/t/AITD-465) iOS/Mac GitHub + SSO sign-in |
| P3 remainder | [AWTD-1111](https://astrid.cc/t/AWTD-1111) installation model · [AWTD-1112](https://astrid.cc/t/AWTD-1112) user tokens + Issues sync migration · [AWTD-1113](https://astrid.cc/t/AWTD-1113) one webhook · [AWTD-1114](https://astrid.cc/t/AWTD-1114) Connections card |
| P4–P8 | [AWTD-1115](https://astrid.cc/t/AWTD-1115) P4 mirror · [AWTD-1116](https://astrid.cc/t/AWTD-1116) P5 write-through · [AWTD-1117](https://astrid.cc/t/AWTD-1117) P6a fields · [AWTD-1118](https://astrid.cc/t/AWTD-1118) P6b spawn recurrence · [AWTD-1119](https://astrid.cc/t/AWTD-1119) P6c rich mapping · [AWTD-1120](https://astrid.cc/t/AWTD-1120) P7 per-org SSO · [AWTD-1121](https://astrid.cc/t/AWTD-1121) P8 brand · [AITD-466](https://astrid.cc/t/AITD-466) iOS/Mac boards · [AWTD2-66](https://astrid.cc/t/AWTD2-66) Windows fixtures |
| Found in review | [AWTD-1095](https://astrid.cc/t/AWTD-1095) /fixall loop clobbers an interactive session · [AWTD-1106](https://astrid.cc/t/AWTD-1106) merge route's unauthenticated comment fetch · [AWTD-1107](https://astrid.cc/t/AWTD-1107) coding agent uses only the first installation · [AWTD-1108](https://astrid.cc/t/AWTD-1108) SSE event names in API_CONTRACT · [AWTD-1109](https://astrid.cc/t/AWTD-1109) shrink the entity-writes allow-list |

