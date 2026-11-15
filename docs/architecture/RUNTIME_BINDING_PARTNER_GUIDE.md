# Business runtime binding: partner and agent guide

**Audience:** a white-label partner, or an agent working for one, who wants their own
machine or service to run Astrid agent work for their boards, on their credentials and
their bill. Start here, then follow the links into code.

**Status (AWTD-1671, 2026-11-15):** the feature is **built and parked**. Phases 1–5
(AWTD-1667 to 1670, plus enrollment 1668) are on `main` and live on astrid.cc, where
they are **inert** because the two flags below are off. Jon decided to park the staging
pilot until a business partner needs it. Everything in "Gaps before activation" is
unfinished on purpose. Design and rationale: [the RFC](./BUSINESS_RUNTIME_BINDING_RFC.md).
Wire contract: [API_CONTRACT.md](../API_CONTRACT.md) (search "runtime binding").

---

## 1. What it is, in five sentences

A **runtime binding** is an admin-approved record saying: *this* runtime (an OAuth client
you own), may run *these* agents, on *these* boards, with *this* credential reference,
paid by *this* business account, one task at a time. Boards without a binding behave
exactly as they always have. A board with a binding never falls back to anyone's personal
key, machine or billing: if the binding cannot be used, the caller gets an explicit
**denial**. Your runtime **polls** the Astrid API; the server never calls it. The pilot
allows one scope, one transport and concurrency one (see §4).

## 2. Where everything lives

| Concern | File |
|---|---|
| Pilot limits (scope, transport, concurrency, billing). Widening one is a decision | `lib/runtime-binding/pilot.ts` |
| Per-board resolution: `legacy` / `bound` / `denied`, and every denial reason | `lib/ai/runtime-binding-resolver.ts` |
| Per-task gate (multi-board agreement, "is the caller the enrolled runtime") | `lib/runtime-binding/task-runtime.ts` |
| Capacity lease and claim fence (`SELECT … FOR UPDATE`) | `lib/runtime-binding/claim-fence.ts` |
| Credential and payer reference, executor-only | `lib/runtime-binding/executor-credential.ts` |
| HTTP shape of a denial (403, or 409 for capacity) | `lib/runtime-binding/denial-response.ts` |
| Enrollment state machine and config validation | `lib/runtime-binding/enrollment-rules.ts`, `enrollment.ts` |
| Audit writes (secrets stripped) | `lib/runtime-binding/audit.ts` |
| Audit retention and export | `audit-retention*.ts`, `audit-export.ts`, `app/api/cron/binding-audit/route.ts`, `app/api/v1/runtime-bindings/[id]/audit-export/route.ts` |
| Admin API and page | `app/api/v1/admin/runtime-bindings/**`, `app/[locale]/admin/runtime-bindings/page.tsx` |
| Flags | `lib/env.ts` (`runtimeBindingPilotEnabled`) |
| Schema | `prisma/schema.prisma`: `RuntimeBinding`, `RuntimeBindingRevision`, `RuntimeBindingAuditEvent`, `TaskList.runtimeBindingId` |
| Tests | `tests/lib/runtime-binding-*.test.ts`, `tests/api/*runtime-binding*.test.ts`, `tests/rules/runtime-binding-*.test.ts` |

Guardrail tests worth knowing: `runtime-binding-credential-refs-stay-in-executor` (only
the executor module reads `credentialRef`), `runtime-binding-schema-additive`, and
`runtime-binding-audit-event-types-are-classified`.

## 3. Switches

| Env var | Effect |
|---|---|
| `ASTRID_RUNTIME_BINDING_RESOLVER=true` | Boards with a binding resolve through it; a bad binding is a denial. Off: the binding column is never read. |
| `ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS=true` | Admin enrollment allowed, and (with the resolver) the pilot is on. **Set only on a dedicated single-business deployment, never astrid.cc.** Off: create, change, verify, approve, activate and attach are refused; suspend, revoke and detach still work. |
| `RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS` / `RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS` | Retention, default and minimum 90 days. Can only extend. |

Both flags off is **rollback**: every response is byte-for-byte what it was before.

## 4. Pilot limits (decisions of 2026-11-14)

- `managementScope = deployment-business`
- `transport = polling`
- `maxConcurrentRuns = 1`
- `billingSource = business-provided`, with a `billingAccountRef`, and a `credentialRef`
- No auto-backfill from `mcpSettings`, stored keys or `aiAgentConfiguredBy`. A binding
  exists only because an admin enrolled it.

Refs (`credentialRef`, `billingAccountRef`, `endpointRef`) are **opaque ids**, never the
secret. They are never returned on the wire and never audited.

## 5. Setting up a partner runtime

1. **Deploy** a dedicated instance (see [WHITELABELING.md](../WHITELABELING.md)) and set
   both flags above.
2. **Create an OAuth client** for the runtime. Its client id is the binding's
   `runtimeSubjectId`. Only that client may discover or claim the binding's work.
3. **Enroll** (deployment admin, browser session; tokens get 403 `session-required`):
   `/admin/runtime-bindings`, or `POST /api/v1/admin/runtime-bindings`.
4. **Walk the lifecycle:** `pending` → `verify` → `approve` → `activate`
   (`POST /:id/lifecycle`). `suspend` and `revoke` stop work at any time. Verification
   refuses a binding that could never run (`pilotConfigurationProblems`). A change that
   **broadens** the binding returns it to `pending` for re-approval; every change writes
   a new revision.
5. **Attach boards** (`POST /:id/boards`). A board already bound elsewhere is held as a
   `board-conflict`, never silently re-pointed.
6. **Run your poller** with that OAuth client, per §6.

## 6. What the runtime does

1. `get_agent_queue { agent, listId }` (`GET /api/v1/agent-queue`). A usable binding adds
   `runtimeBinding: { id, revision }` and `mode: "polling"`.
2. Claim with `POST /api/v1/tasks/:id/claim-fixall` or `…/claim` (MCP `claim_task`);
   `scripts/claim-fixall-task.ts` already treats 409 as "move to the next task".
3. Work, then finish as for any agent task (`docs/FIXALL_WORKFLOW.md`).

### Denials

Shape: `{ error, reason, bindingId, boardId }`. **409** for `capacity-exhausted` (busy,
retry later, not an error). **403** for everything else: surface it, never retry around
it. Treat an unknown `reason` as a denial.

| `reason` | Meaning |
|---|---|
| `binding-missing`, `binding-lookup-failed` | Binding gone or unreadable. Never turned into legacy. |
| `binding-not-active` | Not `active` (pending, verified, suspended or revoked). |
| `revision-unapproved` | Edited since approval. Re-verify and re-approve. |
| `scope-not-business`, `transport-unsupported`, `concurrency-invalid` | Outside the pilot limits. |
| `board-not-enrolled` | Board not attached to the binding. |
| `agent-not-allowed` | Agent not in `allowedAgentIds`. |
| `runtime-subject-missing`, `principal-not-runtime` | No enrolled runtime, or the caller's OAuth client is not it. |
| `credential-missing`, `payer-missing`, `payer-not-business` | No business credential or payer. No personal fallback exists. |
| `board-conflict` | The task's bound boards name different bindings. |
| `capacity-exhausted` | A bound task is already in Doing. |

## 7. The claim fence, in brief

Occupancy is derived: an incomplete **Doing** task on a bound board holds one unit. A
claim opens a transaction, locks the binding row (`FOR UPDATE`), **re-reads** board and
binding, re-checks credential and payer, counts Doing, then claims and writes a
`run-started` audit row in the same transaction. If the audit row cannot be written, the
claim rolls back. Enrollment writes touch the same row, so a suspension cannot interleave
with a claim. Full commentary: header of `claim-fence.ts`.

## 8. Audit and rollback

- Audit export: `GET /api/v1/runtime-bindings/:id/audit-export?format=…` (admin, browser
  session). Retention cron: `/api/cron/binding-audit` daily.
- **Rollback drill (RFC §10):** suspend the binding → new starts are refused → revoke
  grants → reconcile any task left in Doing. Nothing returns to personal billing
  automatically. Stopping actions work even with the flags off.

## 9. Gaps before activation

Not built, by Jon's decision to park (2026-11-15). Do these, in this order, before a real
partner goes live:

1. Run the claim fence against the deployment's **real Postgres**; today it has only run
   against an in-memory model (`tests/fixtures/runtime-binding-pilot-db.ts`).
2. Fence `update_task` → Doing; today it only counts toward capacity.
3. Lease expiry or heartbeat, so a dead runtime frees its capacity without a human.
4. Check `allowedRepositoryRefs` at claim time (stored, not yet consulted).
5. Credential registry and rotation; liveness check on verify; custodian and payer acceptance.
6. Read-only **shadow resolution** on consenting test boards: compare binding vs legacy
   output, change nothing.
7. Choose numeric latency and error budgets **before** activation; monitor denials, queue
   age, lease expiry, duplicates and capacity.
8. Run the rollback drill (§8) on staging.

**First-party astrid.cc enrollment is a separate decision for Jon.** Never enroll it as
a next step.
