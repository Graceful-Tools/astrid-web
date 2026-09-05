# AI workflow implementation handoff

**Prepared:** 2026-09-04

**Purpose:** Continue the seven-phase AI workflow simplification from another harness
without repeating discovery or losing in-progress work.

Start with [the approved review](./AI_WORKFLOW_REVIEW.md). This document records the
implementation state, review findings, pushed branches, and dependency order.

## Ground rules

- Read `ASTRID.md`, `docs/CLI_OPERATIONS.md`, and `docs/FIXALL_WORKFLOW.md`.
- Work the Astrid Web To-do through `get_agent_queue` with the mailbox of the harness
  actually doing the work. Reassign the incomplete tasks to that mailbox before polling.
  Production did not offer a `codex@astrid.cc` assignee when this handoff was prepared, so
  the tasks were deliberately not reassigned to a guessed or newly seeded identity.
- Never push, merge, or deploy without the user's explicit approval. The branches below
  were pushed because the user explicitly requested a durable handoff.
- Do not treat a green branch as accepted until the review status below says accepted.
- Preserve the P1 integration-registry semantics when incorporating P5.

## Task and branch matrix

| Phase | Astrid task | State | Branch / commit | What the next harness must do |
|---|---|---|---|---|
| P1 — Discoverability | `c1c77de4-9dd0-4651-9847-5ef96dd14a34` | **Accepted and complete** | [`jonparis-ai-workflows-p1-discoverability`](https://github.com/Graceful-Tools/astrid-web/tree/jonparis-ai-workflows-p1-discoverability), tip `4d1a5f74fdb801e04a2bd6804cf620b981c86a9e` | Use as the P3 base. Includes follow-up capability gate; do not use `88b17d8` alone. |
| P2 — Guided connection | `dec2fb0f-b420-43d3-bc5d-64f6dbaa6268` | **Review rejected; reopened** | [`jonparis-ai-workflows-p2-connection`](https://github.com/Graceful-Tools/astrid-web/tree/jonparis-ai-workflows-p2-connection), pushed RED-test tip `bf74b73` on implementation commit `1f78b326299c526aaa7402fac33724a0846a2f05` | Run the preserved RED tests, fix the two findings below, rerun gates, and obtain review acceptance. |
| P3 — Cross-harness queue skill | `5f402837-da48-43f8-9e5d-b8cac847f8dd` | **Not started; blocked by P2** | none | Branch from accepted P1, incorporate accepted P2 exactly, then implement the canonical skill and generated adapters. |
| P4 — Ready/Waiting lifecycle | `a1f6e610-5fd4-42cc-8f41-4c382810d341` | **WIP; not accepted** | [`jonparis-productize-ready-waiting-lifecycle`](https://github.com/Graceful-Tools/astrid-web/tree/jonparis-productize-ready-waiting-lifecycle), pushed handoff tip `53b491563dfa20c667fadf385fce5a31621a6ef9`; implementation checkpoint parent `24d7805cbd1baf9ece377f7596fa370cbf14a8fe` | Finish validation and security/idempotency review; details below. |
| P5 — Custom Agents | `53540b6d-0a0d-4a8b-8a2a-4b49beb73726` | **Implemented; pending final review/closure** | [`jonparis-custom-agents-rebrand`](https://github.com/Graceful-Tools/astrid-web/tree/jonparis-custom-agents-rebrand), tip `dedd30a603d7256e207c06a2b345acf94a9a776f` | Review compatibility and reconcile shared files with P1 before acceptance. |
| P6 — Agent hub ownership | `215b6c11-42eb-444c-b82b-63971ffa9dab` | **Not started; blocked by P5** | none | Start only after P5 acceptance; base directly on accepted P5. |
| P7 — Documentation consolidation | `ca847e4c-0766-4fb0-b225-b8dedc98cd09` | **Not started; blocked by P3 + P5** | none | Start after P3 and P5 are accepted; incorporate both exact tips. |

## P2 review findings

The branch is intentionally preserved at the rejected commit so the next harness can make
a small follow-up rather than reconstructing the UI work.

1. The GitHub Actions recipe in `components/agent-runtime-settings.tsx` fetches
   `queue.json` and then only echoes a placeholder. Either wire a genuinely supported agent
   execution that comments, updates, and completes tasks, or remove/relabel the claim that
   this is autonomous execution and present it only as a queue gate.
2. The recipe advertises a 365-day MCP setup token as REST authorization.
   `lib/api-auth-middleware.ts` currently maps legacy MCP tokens to `scopes: ['*']`.
   Do not advertise a wildcard long-lived credential. Prefer short-lived OAuth client
   credentials from `/settings/api-access`, with only the scopes required for queue read
   and task/comment writes, or implement and test a least-privilege MCP-to-REST scope map.
3. Update `tests/components/agent-loop-recipes-tabs.test.tsx`. If auth behavior changes,
   add focused API auth tests proving the credential is not wildcard.

Before rejection, the branch passed 9 focused tests, desktop/mobile Playwright overflow
checks, all predeploy gates (5,045 tests), and `check:reuse`. Those results do not waive the
two functional/security findings. Commit `bf74b73` preserves the unimplemented RED
regressions in `tests/components/agent-loop-recipes-tabs.test.tsx` and
`tests/api/oauth-authentication.test.ts`; start by confirming they fail for the intended
reasons.

## P4 WIP status and risks

The WIP commit includes an opt-in `TaskList.agentLifecycleEnabled` flag, a nullable cursor,
an additive/default-off migration, a centralized mutation boundary in
`lib/agent-lifecycle-mutations.ts`, a CRON-secret-protected reconciliation route, mutation
hooks, and lifecycle tests.

Completed:

- Focused lifecycle/API suite: 36/36.
- TypeScript check.
- First predeploy run passed TypeScript, ESLint, model sync, docs links, API breaking-change
  checks, Prisma generation, brand profiles, and build.
- Initial full Vitest failures caused by route-test Prisma mocks were centralized behind a
  default lifecycle test boundary.
- Rerun of the 17 previously failing files reached 157/158; the last
  `comment.taskId` hook-source failure was fixed and its focused rerun passed.

Still required:

1. Rerun full `npm run predeploy` after the final fix.
2. Run `npm run check:reuse`.
3. Review CRON authorization, bounded cursor batches, multi-tenant opt-in boundaries,
   transaction behavior, repeated/concurrent idempotency, and duplicate audit comments.
4. Review direct AI/system comment writers to ensure content carrying lifecycle markers
   reaches the shared mutation boundary.
5. Replace the WIP commit with a normal follow-up commit if changes are needed; do not
   rewrite the published WIP SHA.
6. Post the completion report and complete P4 only after review acceptance.

## P5 integration contract

P5 passed 105 focused tests, UI/redirect/overflow inspection, `check:reuse`, and all
predeploy gates with 5,027 tests and a production build. Its branch:

- introduces canonical Custom Agent routes and UI;
- leaves `/api/v1/openclaw` handlers as compatibility aliases;
- preserves `.oc@`, `openclaw_worker`, the internal `openclaw` service/mailbox, OAuth
  credentials, SSE, task/comment behavior, and legacy capability fields;
- removes orphaned signing code and obsolete gateway documentation;
- deprecates rather than silently breaking the OpenClaw channel adapter.

When integrating with P1, preserve P1's authoritative shared-file behavior:

- registry id `mcp`;
- capability `integrationMcp`;
- first integration entry named **Connect my coding agent**;
- target `/docs/loops`;
- registry-derived `/docs/integrate` ordering;
- capability-gated Agent Hub guide link.

Layer P5's additive Custom Agents registry row, compatibility capability, terminology, and
peer-row manager on top. Do not resolve shared-file conflicts by choosing one side wholesale.

## Dependency and integration order

1. Accept the P2 follow-up.
2. Build P3 from P1 tip `4d1a5f74`, then incorporate the accepted P2 tip.
3. Independently finish and accept P4.
4. Accept P5 after semantic reconciliation with P1.
5. Build P6 directly on accepted P5.
6. Build P7 on accepted P3 and incorporate accepted P5.

Each phase remains its own reviewable branch. Record exact prerequisite SHAs in each
dependent task and completion report.

## Existing validation evidence

| Phase | Evidence |
|---|---|
| P1 | 69 focused tests; predeploy 9/9 with 5,044 tests; `check:reuse`; coordinator re-review accepted |
| P2 | 9 focused tests; responsive Playwright check; predeploy 9/9 with 5,045 tests; `check:reuse`; **review rejected for functional/security reasons** |
| P4 | Focused 36/36; TypeScript; partial full-suite recovery documented above; **full final gates still required** |
| P5 | 105 focused tests; UI/redirect checks; predeploy 9/9 with 5,027 tests/build; `check:reuse`; **final semantic review required** |

## Lower-cost harness kickoff

First assign the actionable tasks to the real mailbox of the cheaper harness. If using
Claude Code, use `claude`; if Codex is provisioned later, use `codex`. Never poll another
harness's assignments.

Then use this prompt from the repository root, replacing `<mailbox>`:

> Read `ASTRID.md`, `docs/CLI_OPERATIONS.md`, `docs/FIXALL_WORKFLOW.md`,
> `docs/AI_WORKFLOW_REVIEW.md`, and `docs/AI_WORKFLOW_HANDOFF.md`. Run `/fixall` as the
> selected harness mailbox (`agent: "<mailbox>"`) on Astrid Web To-do
> `a623f322-4c3c-49b5-8a94-d2d9f00c82ba`. Continue only the phases listed as incomplete.
> Reuse the published branches and exact commits; do not redo accepted work. Never push,
> merge, or deploy without explicit approval.
