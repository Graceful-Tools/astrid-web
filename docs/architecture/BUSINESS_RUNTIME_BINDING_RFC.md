# RFC: explicit business runtime binding

**Task:** AWTD-1564; agent-integration hardening program AWTD-1547.
**Status:** proposed, awaiting Jon's decisions. Design only: this document adds no
code, schema, migration, credential, deployed configuration or fleet activation.
**Evidence date:** 2026-11-09 UTC.

## 1. Purpose and compatibility boundary

Make "which runtime runs this agent, for whose boards, with whose credentials and
budget?" an explicit, administrator-approved agreement instead of an inference
from an individual's settings.

The proposal is additive and opt-in. A personal account without a binding keeps
the exact existing resolver, defaults, permissions, transport fallbacks and
billing behavior. Existing astrid.cc users and first-party workers are not
automatically enrolled. No business setup may borrow a user's provider key,
machine, subscription or billing account without their explicit authorization.

This RFC specifies a future server-side control plane in astrid-web. It does not
move execution into astrid-core, require a client/SDK upgrade, introduce shared
multi-organization tenancy, authorize unattended shipping, or enable Copilot
cloud execution. Approval of this RFC is not approval to migrate or activate it.

## 2. Verified current behavior

Re-verified against `origin/main` at
`a16f7a8e12b8ff3127a29908472bbdcd547679bd`, not the older task-description snapshot.
Paths below identify current implementation, not proposed behavior.

| Surface | Evidence at that commit | Consequence |
|---|---|---|
| User settings | `prisma/schema.prisma:50,62`; `lib/ai/agent-execution-mode.ts:187-230` | `User.aiAssistantSettings` and `User.mcpSettings` hold user configuration; execution modes and stored provider-key presence are read from `mcpSettings`. |
| Mode defaults | `lib/ai/agent-execution-mode.ts:38-70,122-145,216-230` | Modes are `api`, `polling`, `webhook`, `off`. Explicit stored modes and credential presence influence defaults; local harness mailboxes lack a server executor. Preserve the existing pure and database-backed resolver behavior as implemented, without normalizing their differences in this work. |
| Run owner and payer | `lib/ai/agent-execution-mode.ts:354-395` | `resolveAgentRunBilling` selects configured-by, then supplied list owner, then supplied creator. The caller supplies the board context; this is not an organization/runtime registry. |
| Dispatch context | `lib/webhooks/task-assignment-notifier.ts:170-174,247-280`; `lib/webhooks/comment-notifier.ts:131-135`; `lib/comments/post-comment-side-effects.ts:323-330` | Assignment/comment notifiers use the first list's configured-by/owner; coding-workflow resumption selects a repository-bearing list and can fall back to the commenter. There is not one globally uniform board-selection rule. |
| Transport fallback | `lib/webhooks/task-assignment-notifier.ts:241-280` | OpenClaw has a separate SSE path; other agents may suppress dispatch for polling, then try a user webhook and an environment-configured remote fallback. A binding must not silently reuse that fallback chain. |
| Queue principal | `lib/agent-queue.ts:280-285,303-335` | The queue resolves mode for the authenticated caller and locates the agent identity separately. Task visibility is the caller's; inclusion of unassigned Ready tasks has additional board-membership constraints. |
| Existing agent/list records | `prisma/schema.prisma:154-170,225-230` | Agent service/configuration and list agent/repository/configured-by fields exist, but do not constitute an enrolled machine, credential, billing and scope agreement. |

White-label context was also read directly with git from
`origin/awtd-1558-agent-setup` at
`219805b01c825b28eb58eb534084064fd9645f43`:
`docs/WHITELABELING.md:297-306` states one customer organization per deployment,
with its own database and keys. That unmerged branch is context, **not a dependency
or a shipped authorization feature**. The current [white-label guide](../WHITELABELING.md)
and [platform assessment](./PLATFORM_ASSESSMENT_2026-11.md) provide broader context.
No production database, secret, customer configuration or runtime was inspected.

## 3. Personal and business requirements

| Requirement | Personal, no binding | Explicitly enrolled business binding |
|---|---|---|
| Setup | Existing AI Agents settings and recipes, unchanged | An administrator proposes scope and payer; runtime custodian accepts; administrator activates after verification. |
| Ownership | Existing run-owner resolution | Separate accountable configuration owner, execution custodian, agent principal and payer. Ownership alone grants none of the other roles. |
| Agents | Existing mailbox/service defaults | Enumerated brand-aware agent identities and supported executor capabilities; no wildcard or provider-name equivalence. |
| Data access | Existing task/list permissions and token policy | Existing authorization intersected with binding board/repository allow-lists and credential/token grants. Public visibility alone does not enroll a business board. |
| Transport | Existing API/polling/webhook/SSE paths and fallbacks | One explicitly verified transport per binding; no opportunistic fallback to a different runtime or payer. |
| Concurrency | Existing worker behavior | Positive bounded limit enforced centrally through claims/leases, plus any lower machine/provider/billing limits. |
| Billing | Existing configured-by/list-owner/creator selection | Explicit payer acceptance; missing funding or credential stops execution, never charges a personal fallback key. |
| Lifecycle | Existing revoke/settings behavior | Enrollment, approval, activation, suspension, rotation and revocation are audited and versioned. |

Both paths retain existing task eligibility, assignment, due-date rules, list
permissions, agent identity separation and no-production-credential boundaries.
Bindings do not create board membership, repository access, merge permission or
deployment permission. Board configuration uses the existing
[permission helpers](../CODE_REUSE_AND_CONSISTENCY.md); binding-administration
rights are an additional requirement, not a replacement for those helpers.

## 4. Proposed additive model

Names and storage representation are provisional. This is a logical model, **not
Prisma syntax or a migration to apply**. An absent association is represented by
null, not by creating a synthetic binding for every existing account.

| Proposed field or association | Meaning and invariant |
|---|---|
| `TaskList.runtimeBindingId?` | Nullable foreign-key-style association. Null selects the unchanged legacy path. Initial scope is board-level only; no automatic user/deployment default. |
| `RuntimeBinding.id`, `revision`, timestamps | Stable opaque ID, optimistic-concurrency revision and lifecycle timestamps. Configuration revisions are immutable snapshots; updates produce a new revision. |
| `ownerUserId` | Accountable human configuration owner in this deployment. Business records survive owner offboarding and require audited transfer; deletion must not cascade them or clear board associations into legacy mode. |
| `managementScope` | `personal` or `deployment-business`. Business scope is the existing deployment/database boundary, not an invented organization foreign key. Multiple businesses sharing astrid.cc infrastructure are out of scope for phase one. |
| `runtimeKind`, `runtimeSubjectId` | `user-machine`, `business-machine`, `astrid-hosted`, or `provider-hosted`, plus an enrolled opaque machine/service identity. One ID denotes one capacity pool; aliases cannot multiply its concurrency limit. |
| `runtimeCustodianUserId?` | Human accepting use of a machine/subscription where applicable. Hosted service ownership is a verified deployment-local service record, not an arbitrary user-entered endpoint. |
| `allowedAgentIds` | Non-empty set of exact agent principals/mailboxes resolved using the brand agent registry; explicitly distinct local and cloud identities. |
| `transport` | One of `polling`, `signed-webhook`, `provider-api`, `sse-channel`, `native-cloud-bridge`, with its verified adapter/capabilities. These are transport descriptors, not new values written into today's user mode settings. |
| `endpointRef?`, `credentialRef?` | Opaque deployment-local references to approved endpoint metadata and a separately protected credential record. Never a token, key, secret-manager value, raw credential URL or serialized user settings. Reference metadata includes custodian, purpose, grant bounds and credential generation. Credentialless transport is permitted only if its adapter explicitly supports it. |
| `allowedRepositoryRefs`, `allowedBoardIds` | Explicit sets of stable repository host/installation/repository identities and Astrid list IDs. Empty means deny all for that resource type, never unrestricted; a board-only non-coding binding may intentionally have no repositories. No free-text URL matching or implicit access to all boards on a task. |
| `maxConcurrentRuns` | Positive integer, initially recommended as one; includes all allowed agents and boards sharing the binding. Intersect with enrolled runtime capacity and payer/provider limits across bindings. |
| `billingSource`, `billingAccountRef?` | `personal-authorized`, `business-provided`, or `deployment-hosted`, with explicit consent and funding reference as required. References identify a payer/grant, never payment details. Runtime selection cannot imply a payer. |
| `state` | `pending`, `verified`, `active`, `suspended`, `revoked`. Only `active` can obtain new work; a denied binding never behaves like null. |
| `enrolledBy`, `approvedBy`, `approvedRevision`, `verifiedAt` | Audit-linked actors and the exact approved snapshot. Approvals cannot silently carry over to broader scope, changed runtime/transport, higher concurrency or a different payer. |
| `RuntimeBindingAuditEvent` | Append-only lifecycle, approval, resolution, authorization and run events described below. No secret material or task prompt content. |

Reuse existing credential custody and Connections revocation mechanisms wherever
their ownership/grant model fits. A business-owned credential reference may need
an additive registry entry if existing records cannot express it; do not pretend
a personal OAuth client's owner is a business principal. Never copy personal
encrypted credentials into the binding table. Credential retrieval is restricted
to the selected executor/dispatcher, not queue clients, list editors or audit readers.

## 5. Resolution and dual-read contract

Future implementation should have one context-aware resolution entry point for
**bound** work. Preserve legacy entry points underneath it; do not rewrite today's
owner selection, credential detection, mode defaults or failure handling.

1. Determine the execution board and repository using trusted stored context,
   authenticated principal and operation type. For an existing unbound task,
   invoke the exact current caller-specific resolution path.
2. If a board has an association, load the exact binding and approved revision.
   Verify active state, management scope, board enrollment, agent, transport
   capability, credential generation, payer consent and applicable repository.
   Missing/deleted references, lookup failures, ambiguity and invalid
   configuration are explicit denials, **not legacy fallback**.
3. Intersect existing caller/agent task permissions, membership, token grants,
   binding scope and transport policy. A binding can narrow access, never widen it.
   Resolve a typed plan containing board, repository, binding/revision, runtime,
   agent principal, credential reference/generation and payer reference.
4. Queue discovery is advisory. Atomically revalidate this plan when claiming and
   again before credential use/dispatch. Attach the plan identity to the run/lease.
   Polling and pushed work compete through the same exclusive execution contract.
5. If no association exists, call today's user-setting resolution unchanged.
   Do not synthesize a business binding, normalize stored settings, or replace a
   missing user with a business administrator.

**Multiple boards:** for a task touching any bound board, require a trusted,
authorized `executionBoardId` from the stored dispatch/claim context; never choose
the first list or accept a caller's arbitrary binding ID. All associated bound
boards must agree on the same active binding and allow that task's repository;
otherwise deny with a visible configuration-conflict reason. Unbound additional
boards do not broaden execution or data access. Moving the task, changing its
repository or changing a board association invalidates an unstarted plan. This
stricter rule applies only to enrolled work; legacy-only tasks keep today's rules.

**Surface consistency:** assignment dispatch, comment dispatch, workflow
creation/resumption, approval detection, queue/count/attention, atomic claims,
native bridge, SSE channel and settings/agent pickers must share the bound plan.
Existing account-level mode and version-1 queue responses remain unchanged for
unbound callers. Add binding-aware discovery under an explicitly versioned or
negotiated interface; do not reinterpret existing response fields. Legacy clients
may continue personal work, but cannot execute bound work until their principal
and adapter support binding enforcement. Administration can start web-only.

## 6. Explicit enrollment and administration

Phase one uses a deployment-local, explicitly provisioned administrator grant;
no new organization model, email-domain-derived admin status, automatic SSO-group
mapping or elevation of every list owner. Reuse an existing administrative grant
only after verifying that its scope covers runtime administration. The future
implementation must document grant provisioning and recovery before activation.

An administrator registers a pending binding, exact runtime, allowed agents,
boards/repositories, credential reference, concurrency and payer. Every board
attachment also requires its current management permission. The runtime custodian
and payer accept their respective grants through authenticated UI; an account
cannot approve use of somebody else's machine or credential.

Verification proves runtime ownership/liveness and supported transport with a
bounded, non-task challenge. It must not claim Ready work, invoke a billable model,
start a native cloud session or trigger a webhook carrying customer data. The
administrator approves the exact revision after seeing the proposed effective
scope. Activation and board attachment commit atomically against that revision.
If there is only one administrator, self-approval is recorded as such; two-person
approval can be a later policy rather than an undocumented requirement.

Scope expansion, transport/runtime replacement, credential ownership changes,
concurrency increases and payer changes return to pending approval. Credential
rotation under the same grant uses a new generation and audited verification;
revocation immediately blocks new starts and stale tokens. Suspension is
immediate; resumption is an explicit administrative action.

The AI Agents surface shows personal settings unchanged and business enrollment
only to authorized administrators/custodians. Connections shows ownership,
purpose and revoke controls without exposing credentials. A member can see an
appropriate blocked/available status, not secret references or other boards'
configuration. Owner/admin offboarding suspends bindings without a valid
successor; it never silently transfers billing to a board owner.

## 7. Audit and operational behavior

Persist actor/principal, event type, binding ID/revision, affected board/repository
IDs, previous/new scope summary, consent/approval event IDs, reason code,
timestamp, request/correlation ID, run/lease ID and transport outcome.
Audit credential reference identity/generation, not its value. Never record
tokens, headers, webhook secrets, raw prompts, endpoint credentials or payment
information. Audit reads require a scoped administrative permission and have an
explicit retention/export policy; retention length remains a Decision below.

Configuration changes and approvals must commit with their audit event. New
bound claims fail closed if their required audit/lease record cannot persist.
Denied operations remain explicit errors even if a secondary diagnostic sink is
unavailable. Operators see distinctions between no work, denied scope, suspended
binding, exhausted capacity, unfunded payer and unhealthy transport. Waiting for
capacity is not success; webhook acceptance is not task completion.

A suspended/revoked/changed binding admits no new starts. Running work retains its
immutable attribution, but every lease renewal and privileged write revalidates
current authorization. Loss of renewal means the worker stops before further
writes. Cancellation is best-effort where supported; no design can undo a
provider request or external side effect already accepted. Ambiguous delivery
must be reconciled by idempotency/run identity before retrying or reassigning.

## 8. Interfaces with the hardening program

These are requirements on future integration, not assertions that the linked
tasks have shipped or a reason to copy their implementation into this RFC.

| Related task | Runtime-binding contract |
|---|---|
| AWTD-1561: webhook policy | Resolve `endpointRef` through the shared endpoint/egress policy, enforce destination and redirect/DNS rules at send time, and require transport authentication and replay protection. Enrollment cannot whitelist around that policy. Binding revision and run identity accompany dispatch; credential references never appear in payloads. No fallback to a user/environment webhook for bound work. |
| AWTD-1555: claims/leases | Add binding/revision/runtime/agent/board/repository/payer attribution to the atomic claim and lease. Revalidate eligibility, assignment, scope and capacity transactionally; shared runtime capacity cannot be oversubscribed across bindings or server replicas. Leases have bounded expiry, renewals and stale-worker fencing. Native dispatch may require a reconciled non-renewing external run reservation instead of assuming an external worker can heartbeat. Do not fork the claim algorithm. |
| AWTD-1549: token scope | Effective authorization is token grant intersected with current principal permissions, binding agent/board/repository scope and lease authority. Neither a global agent mailbox nor a legacy wildcard grant authorizes a business runtime. Preserve existing personal compatibility policy; require explicitly binding-scoped credentials for enrolled work and revoke stale generations. |
| AWTD-1383 / AWTD-1474: Copilot cloud activation | `native-cloud-bridge` describes GitHub's native issue-assigned agent, not Copilot CLI. Distinguish dispatcher credentials from worker credentials, verify repository assignability/setup/MCP grants and reconcile provider session mapping. A stored binding does not enable a schedule or waive an authorized smoke test; activation remains separately approved. |
| astrid-core and native clients | Keep control-plane resolution, credentials and transport I/O in web. No core pin/SDK bump in this task. If a later shared rule or wire shape changes, follow [cross-platform contracts](../../ASTRID.md#cross-platform-contracts), generate fixtures in web first and separately port/verify core and clients. |

## 9. Additive migration plan for a later approved implementation

1. Separately review schema and migration impact. Add binding, revision,
   enrollment/audit records and nullable board association without changing any
   existing column/default, removing data or adding a required field to old rows.
   Evaluate indexes and lock duration against production-sized staging data.
2. Deploy schema before code that reads it. Old code must continue to work with
   every association null. **Do not attach bindings while old executors can still
   claim those boards**; nullable columns alone cannot stop a legacy executor.
3. Ship binding-aware readers/writers and adapters disabled. Verify all execution
   surfaces and token/claim/webhook contracts in isolated test environments.
   Record unsupported adapter capability as an enrollment blocker.
4. Enable read-only shadow resolution for explicitly consenting test boards.
   Compare legacy outputs without changing dispatch, queues, credentials,
   assignment, billing or active flags. Do not auto-backfill bindings by inferring
   consent from `mcpSettings`, existing keys or `aiAgentConfiguredBy`.
5. Enroll new business boards first, with audited approval and runtime/payer
   consent. Pause their legacy workers and dispatch during cutover; establish
   scoped grants and prove exclusion of incompatible executors before activating.
   Keep existing personal and first-party boards null throughout the pilot.

No migration is created or applied by AWTD-1564. A subsequent production migration
requires its own impact review and authorization under
[CLI operations](../CLI_OPERATIONS.md).

## 10. Rollout, rollback and acceptance evidence

Future activation is disabled by default and controlled per deployment and
explicit binding/board, independently of existing personal settings. Start with
isolated staging, then one consenting business runtime on a dedicated deployment.
First-party astrid.cc enrollment is a separate decision, not the next automatic
step. Unsupported transport or missing prerequisite holds enrollment.

Before any rollout, prove the following with regression/contract tests and a
bounded authorized smoke test:

| Evidence | Required result |
|---|---|
| Null bindings across all legacy modes, stored-key combinations and owner contexts | Existing resolver outputs, queue wire shapes, transport order and billing attribution unchanged; no extra dispatch or credential minting. Include first-party assistant, local harnesses and OpenClaw. |
| Bound happy paths for each supported adapter | Exactly one eligible runtime/agent/payer and one authorized run; unrelated boards/principals cannot discover or claim it. |
| Invalid/revoked/missing binding, ambiguous boards, missing credential/payer and dependency outages | Visible denial; zero legacy fallback, personal key use or alternate transport. |
| Concurrent claims and configuration/assignment/repository changes | No duplicate run or oversubscribed runtime; stale plans/leases fenced before dispatch/write. |
| Old clients/workers and multi-replica servers | Personal clients keep working; incompatible workers cannot execute enrolled boards; capacity and audit are durable. |
| Rotation, suspension, offboarding and rollback drill | New starts stop, attribution persists, in-flight work is reconciled, and no automatic return to personal billing occurs. |

Monitor binding denial rates/reasons, queue age, lease expiry/duplicate attempts,
capacity usage and transport failure/acceptance reconciliation. Any unintended
personal dispatch, cross-scope execution, payer mismatch or unfenced stale write
stops the pilot immediately. Measure personal/first-party latency and error rates
against the pre-rollout baseline; choose numerical budgets before activation.

**Rollback is not "ignore the binding and read personal settings."** Suspend
enrolled bindings, block new starts, revoke scoped grants where necessary and
reconcile/drain running work. Keep associations and audit records so denial
remains explicit. An emergency execution-disable switch may stop bound work, but
must not make a non-null binding act like null.

Reverting to an older, binding-unaware server is safe only after enrolled boards
are isolated from *all* legacy dispatch/claim paths and in-flight work is
reconciled; otherwise older code can spend personal credentials again. Prefer a
binding-aware disabled build. Restore an individual board to legacy mode only by
an audited admin detachment plus the prospective legacy runtime/payer's explicit
consent, after pausing incompatible workers and proving the old plan is safe.
Leave additive tables/nullable columns in place; no destructive down migration.

## Decision

The recommended choices below minimize the production blast radius. Jon's answers
approve a design direction only; implementation, migration review, credentials
and runtime activation remain separate tasks and approvals.

**Decision:** Where should business runtime ownership live in the first release?

- **1.** Board-level opt-in on a dedicated single-business deployment; no automatic enrollment on astrid.cc (recommended)
- **2.** Add an organization/workspace authorization model first, then support business bindings on shared astrid.cc infrastructure

**Decision:** How should multiple boards choose a runtime?

- **1.** Require one trusted execution board and agreement among all bound boards; hold conflicts rather than choosing the first list (recommended)
- **2.** Design an explicit per-task execution-board override with separate approval and conflict rules before implementation

**Decision:** Which transports and capacity should the pilot support?

- **1.** One enrolled polling runtime, maximum concurrency one; add webhook and hosted/native adapters only after their policy, lease and scope contracts are verified (recommended)
- **2.** Implement and verify polling, signed webhook and hosted/native adapters together before any business pilot

**Decision:** Who pays for business pilot executions?

- **1.** Business-provided credentials or explicitly accepted business subscriptions; no personal or deployment-hosted fallback billing (recommended)
- **2.** Include deployment-hosted metered billing after separately approving budgets, attribution and funding enforcement

**Decision:** What audit retention should the first release require?

- **1.** Ninety days of detailed operational events with controlled export; retain consent, approval, revocation and run-attribution records for the binding lifecycle plus ninety days, subject to deployment policy/legal review (recommended)
- **2.** Require each business to choose retention and export policy during enrollment; block activation until configured
