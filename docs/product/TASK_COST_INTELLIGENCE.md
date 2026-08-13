# Task Cost Intelligence

*Spec of record for per-task cost estimation and actuals. Proposal, not yet built.*

Status: **draft v1** (2026-08-12). Grew out of the Paperclip review, which found
that Paperclip's one genuinely enviable capability is cost control — and that
`schema.prisma` has **zero** occurrences of cost, budget, token or spend.

Gated exactly like [Project Mode](./PROJECT_MODE.md): a build-time capability
times a runtime flag, administered from `/admin/features`.

---

## The goal

Every task carries **what we thought it would cost** and **what it actually
cost**. The gap between those two numbers, accumulated over hundreds of tasks,
is the product.

A ticket system that knows its own unit economics can answer questions no
task manager currently answers: *which list burns the most per task, which
agent is cheapest for this kind of work, is this project's cost per shipped
task going up or down.* That is a cost-intelligence system that happens to
also be a to-do list — and it rolls up from the task, so the org-level number
is derived rather than guessed.

## The bet

**Actuals must be free.** The estimate is a judgement call and can be entered
by a human. The actual cannot: any design where someone types in what a task
cost is a design where, after two weeks, nobody does, and the intelligence
layer trains on an empty table.

So the load-bearing question in this whole spec is not the schema or the UI. It
is: **who reports the actual, and through what contract.** Everything else is
downstream of that. See [The reporting contract](#the-reporting-contract).

> A cost feature whose actuals are hand-entered is a spreadsheet with extra
> steps. If we cannot make actuals automatic, we should not build this.

## Progressive disclosure

Same rule as Project Mode: **an existing single-player user must see nothing
new before opting in.** Cost fields are nullable, draw zero pixels while null,
and the entire surface sits behind the flag. A user who never turns it on has
the same Astrid they had yesterday.

---

## Data model

Two shapes, and the split matters.

### Estimate — a nullable field on `Task`

```prisma
/// Expected cost in cents at the time work was authorised. Null = never
/// estimated, which is the overwhelmingly common case and draws no UI.
costEstimateCents  Int?
/// How the estimate was produced: human | cohort | model.
costEstimateSource String?
```

An estimate is **one value that belongs to the task**, so it lives on the task.
Snapshot semantics: it records what we believed *before* the work, and is never
recomputed afterwards — otherwise variance is measuring nothing.

### Actuals — an append-only ledger

```prisma
model TaskCostEvent {
  id            String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  taskId        String
  /// Which agent incurred it, when we know.
  aiAgentId     String?
  provider      String   // anthropic | openai | …
  model         String   // claude-opus-5 | …
  inputTokens   Int
  outputTokens  Int
  /// Cost in cents, COMPUTED AND FROZEN AT WRITE TIME. See below.
  costCents     Int
  /// Idempotency key from the reporter, so a retried report is not double-counted.
  externalId    String?
  createdAt     DateTime @default(now())

  @@unique([taskId, externalId])
  @@index([taskId])
  @@index([aiAgentId, createdAt])
}
```

A task's actual cost is `sum(costCents)` over its events. Do **not** denormalise
a total onto `Task` in v1; add a cached column only after a measurement shows
the sum is slow, and say so in the commit.

### Why cost is frozen at write time

Token counts are facts. Money is a fact *about a price list that changes.* If
we stored only tokens and multiplied by today's prices at read time, every
historical task would silently re-price itself whenever a provider changed its
rates, and last quarter's variance analysis would quietly become fiction.

So: store the tokens **and** the money, compute the money once, never
recompute. If a price was wrong, correct it with a compensating event rather
than an `UPDATE` — the ledger is the audit trail.

---

## The reporting contract

The crux. Astrid does not currently receive token counts from anything.

Two sources, in order of how much they are worth:

**1. Astrid's own coding workflow.** `app/api/coding-workflow/*` already
dispatches agent work (`start-ai-orchestration`, `start-tools-workflow`) and
already has approval gates. These are the dispatch points, so they are also the
natural reporting points — a run that Astrid started is a run Astrid can meter.

**2. External agents over MCP.** Astrid is already an MCP server with scoped
per-list tokens. Add one write operation:

```
POST /api/v1/tasks/:id/cost
{ provider, model, inputTokens, outputTokens, externalId }
```

…and the matching MCP tool, so an agent that just did work on a task can report
what it spent. Scope it to the existing `mcpAccessLevel` write permission; do
not invent a parallel permission model.

**The honest risk:** agents have to actually call it. If the first integration
(our own coding workflow) does not produce events reliably, stop — the rest of
this spec is decoration on an empty table.

---

## The intelligence loop

Estimate → actual → variance → better estimate. Four phases, each shippable.

**Do not start with machine learning.** The first useful predictor is a median:

> For a task on list L assigned to agent A, the predicted cost is the **median
> actual** of the last N completed tasks matching that cohort — shown only once
> the cohort has **at least 5 samples**, and shown as a range, not a point.

That is testable, explainable to a user, and beats a model nobody can debug. It
also fails visibly: a cohort with four samples shows nothing rather than
inventing a number.

Cohort keys available in Astrid today, roughly in order of likely signal:
list → assigned agent → labels (`listType: "label"`) → priority → parent.
Start with (list, agent). Add a key only when the data shows it reduces
variance; every extra key splits the sample and slows the cold start.

**What "building intelligence" means concretely:** with estimate and actual
both recorded, we can report *estimation error* per cohort, which is the number
that tells you whether the system is learning. Track it from day one — a
learning loop with no measure of its own accuracy is a slogan.

---

## Rollups

Per-list, per-project and per-agent totals are queries over `TaskCostEvent`,
not new tables. The org-level number is a `SUM` — that is the point of metering
at the task. Build read models only when a query is measured slow.

## Budgets — later, and server-side

Budgets are phase 4 and deliberately after the loop works. When they land:

- A budget is a **per-list monthly ceiling** (lists are already the permission
  boundary; do not introduce a new scope noun to hang money on).
- Warn at a threshold, hard-stop at the ceiling.
- **The stop is enforced where agent work is dispatched**, server-side, not by
  hiding a button. A UI-only budget is not a budget.

---

## Gating

Mirror `lib/project-mode.ts` exactly, including the file split that keeps the
key client-safe:

| Piece | File |
|---|---|
| Client-safe key | `lib/task-cost-shared.ts` — `TASK_COST_FEATURE_KEY = 'task_cost'` |
| Two-gate check | `lib/task-cost.ts` — `taskCostCompiledIn()` + `canUseTaskCost(userId)` |
| Build-time capability | `CAPABILITIES.taskCost` ← `NEXT_PUBLIC_BRAND_ENABLE_TASK_COST` |
| Runtime flag | add `'task_cost'` to `FEATURE_KEYS` in `lib/feature-flags.ts` |
| Admin | `/admin/features` — works as soon as the key exists |
| Request access | existing feature-access-request flow, as Board View uses |

Order matters and is not negotiable: capability first (absolute, per
deployment), then the flag (per user). **Never inline the pair at a call site** —
that is the drift documented in
[CODE_REUSE_AND_CONSISTENCY.md](../CODE_REUSE_AND_CONSISTENCY.md), and Project
Mode already paid for the lesson.

Rollout uses the existing modes — `OFF | ALL | PERCENTAGE | SELECTED_USERS`
with stable per-user bucketing — so this needs no new rollout machinery.

---

## Phasing

| Phase | Ships | Done when |
|---|---|---|
| **0** | Flag, capability, schema, write path. No UI. | An agent run writes a `TaskCostEvent`, and a user without the flag sees nothing. |
| **1** | Actual cost on the task detail. | A completed agent task shows what it cost, from real events. |
| **2** | Estimate field + variance display. | Estimate and actual are both visible, with the gap. |
| **3** | Cohort-median prediction, ≥5 samples, shown as a range. | Estimation error per cohort is itself reported. |
| **4** | Budgets, thresholds, server-side hard stop. | Exceeding a list budget actually refuses to dispatch. |

Phase 0 is the one that decides whether this is real. **Stop after it if
actuals do not arrive reliably.**

---

## Open questions — Jon's calls

1. **Human effort.** v1 meters agent money only, because it is the part that is
   objectively measurable without asking anyone to type anything. Should human
   time ever join the same number (time × rate), or stay a separate axis?
   *Recommendation: separate, and much later — a blended number no one can
   reconstruct is worse than two clear ones.*
2. **Who sees cost.** Whole list, or owner/admin only? Cost is closer to
   `showSubtasks` (list-level, admin-gated) than to a filter.
   *Recommendation: owner/admin, matching `canUserManageList`.*
3. **Currency.** Cents in one currency, or multi-currency from the start?
   *Recommendation: integer cents, one currency, documented — multi-currency is
   a conversion-rate snapshot problem and belongs with budgets in phase 4.*
