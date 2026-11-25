# Spec: Goals, Guardrails and Signals

*Spec of record for linking work to goals, reading a goal's state from outside Astrid,
linking tasks to experiments, estimating an idea's impact and risk, and the trade-off policy
that labels and sorts ideas. Task **ADEV-269**.*

Status: **decided, not implemented** (2026-11-25). Companion to
[PROJECT_MODE.md](../product/PROJECT_MODE.md), which governs gating and progressive
disclosure; to [DECISIONS.md](../DECISIONS.md), which governs the decision grid; and to
astrid-core's `docs/GOAL_SIGNALS.md`, which governs the rules that live in the core (the
trade-off policy, the new autonomy actions, the Pending results lane and the policy sort).
This file governs **the model, the three HTTP contracts, the server's behaviour, the
surfaces and the gate**.

> The ask, in Jon's words (2026-11-25, condensed from dictation): *"…the goals, guardrails,
> and guidance workflow, where any task can be attached, or any list can be attached to
> top-level goals, or any project can be attached to top-level goals. We should … make it
> very easy to … assign how to measure the current state of a goal, and that should be able
> to plug into external systems … And then you should also be able to connect it very easily
> to an experiment system. So if a task is linked to an experiment, you can tell whether …
> a deployment is improving or not improving … And the experiment system can then … based on
> the goals, recommend start, stop, etc. … in the ideas section … they can just tap one
> button … and connect with an external estimated impact and an estimated risk service.
> Those services can be defined by … the environment. We can also spec out building a simple
> one for Astrid using just an LM of their choice. … it can come back with … the estimated
> impact on the goal metrics, the estimated impact on the guardrail metrics, and maybe a
> risk score … And they can set policies on what to do given different scenarios of
> trade-offs against goals, guardrails, and risks. So we want to allow that as like a sort
> function. … this is kind of an advanced feature that can be behind a gateway … We also
> want to … communicate understanding of that estimated impact, estimated costs, estimated
> opportunity based on reach … after in the doing, you can add a column for … pending
> experiment results or pending verification results."*

---

## The one thing this spec is really about

**Goals already exist. What is missing is every arrow in and out of them.**

Today a project states goals and guardrails (`Project.goalsAndGuardrails`,
`lib/goals-guardrails.ts`, ADEV-179), a person or an agent types a measurement
(`update_goal_measure`), and an agent says which goal a task serves with a `GOAL: g1`
comment line. Nothing reads a number from where the number actually lives, nothing says
what an idea would do to a goal before it is built, and nothing says what it did after.

This spec adds four arrows and one rule, and nothing else:

| Arrow | From → to | Section |
|---|---|---|
| Link | task or list → goal | [Links](#1-links-tasks-and-lists-to-goals) |
| Measure | external metric source → goal, guardrail | [Measures](#2-measures-a-goal-with-a-number-and-a-source) |
| Estimate | idea → expected effect on goals, guardrails, risk, cost, reach | [Estimates](#4-estimates) |
| Result | experiment or verification → task | [Experiments](#5-experiments-and-verification) |
| **Rule** | estimate + policy → label and order | [Trade-off policy](#6-the-trade-off-policy) |

**Goals stay per project** (Jon, 2026-11-25). "Top-level" means the project's goals, the
level above its lists and tasks. A goal shared by two projects is not built.

**The risk is a second goal system.** Every piece below extends the existing JSON, the
existing orchestration policy, the existing approvals, the existing lanes. A new table
exists only where the thing is a relation or a ledger, the way `TaskDependency` and
`TaskCostEvent` are.

Names of tables, env vars, the capability and the `results` role are this spec's. The
implementing task may rename one; it then changes it here in the same PR.

---

## Decisions

Taken by Jon, 2026-11-25:

1. Goals stay per project; lists and tasks link to their project's goals.
2. The first release ships open, Astrid-defined HTTP contracts only. Adapters for named
   vendors come later and are thin translations onto these contracts.
3. A policy ranks, labels and recommends. Acting on it (promoting an idea, starting or
   stopping an experiment) is `allowed` / `ask` / `never` per board, default `never`.

Taken by the agent as the recommended option, open to Jon's override:

4. A new **Pending results** preset column (role `results`) with entry and exit rules.
   `testing` is unchanged: boards already use it as a column with no rules.
   **Amended by Jon, 2026-11-25: no board gets this column unless a person adds it.**
   Setting it up is one tap ([section 7](#7-the-pending-results-lane)).
5. Results that pass move the task to Done by rule. A regression, an inconclusive result at
   the deadline, or a silent source hands the task back with a Decision. Nothing rolls back
   automatically.
6. The policy sort is four fixed labels and a fixed, lexicographic order. No combined
   score, no weights. DECISIONS.md rule 7 stands: the grid still has no score column. A
   risk score the estimator reports is shown as reported, attributed to its source.
7. An agent asking the built-in estimator spends the user's key, so it is answered by the
   existing `spend` autonomy.
8. First release is web only. Native clients draw nothing new until the last phase; an
   unknown sort already reads as `auto` there.

---

## The model

Every migration is additive: four new tables, no new column on an existing table, and
optional keys added to two JSON shapes.

### 1. Links: tasks and lists to goals

```prisma
/// A task or a list serves one of its project's goals (ADEV-269).
///
/// A row rather than a goal id on Task: a task can sit on lists in different
/// projects, so a bare "g1" on the task names nothing. Exactly one of taskId
/// and listId is set. Rows exist only where someone linked something.
model GoalLink {
  id          String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  projectId   String
  /// The goal's id inside Project.goalsAndGuardrails. Not a foreign key:
  /// goals are JSON. A link to an id the project no longer states is ignored
  /// on read and deleted in the same transaction as the goals write.
  goalId      String
  taskId      String?
  listId      String?
  /// "person" | "agent" | "report" (a GOAL: comment line).
  source      String
  createdById String
  createdAt   DateTime @default(now())

  @@unique([taskId, projectId, goalId])
  @@unique([listId, goalId])
  @@index([projectId, goalId])
}
```

- **A task's goals** are its own links plus the links of its lists in that project, computed
  on read. Nothing is copied down.
- **The `GOAL:` comment line keeps working.** `goalIdsServed` still parses it; the comment
  write path upserts a `GoalLink` with `source: "report"`. `workByGoal` in
  `services/project-goals.service.ts` reads the table instead of scanning comments. A
  one-off job backfills links from existing comments.
- **Who may link:** anyone who can write the task, agents included. Linking a list needs
  list admin.
- Links need only Project Mode, not the gate below.

### 2. Measures: a goal with a number and a source

`ProjectGoal` gains one optional key beside its free text:

```ts
metric?: {
  unit?: string                 // "%", "ms", "users"
  direction: 'up' | 'down'      // which way is better
  target?: number
  baseline?: number
  current?: number              // server-written
  measuredAt?: string           // server-written
  source?: { connectorId: string; metricKey: string }
  staleAfterHours?: number      // default 48
}
```

- `GoalMeasurement` gains `num?: number` and `source?: 'human' | 'agent' | 'push' | 'pull'`.
- `goalProgress` prefers `metric` and falls back to today's first-number-in-the-string
  reading. No backfill; a goal without `metric` behaves exactly as today.
- **Preserve on omit.** A goals PUT that leaves `metric` out keeps the stored block; an
  explicit `null` clears it. Without this an older client's save unbinds the source
  silently. This rule ships before anything binds a source.
- `ProjectGuardrail.check` gains the second type its own comment anticipates:
  `{ type: 'metric', source: { connectorId, metricKey }, op: '<=' | '>=', threshold, unit? }`
  with `current` and `measuredAt` server-written. `guardrailViolations` reads it; a stale
  or missing value is "unknown", never "passing".
- The limits in `lib/goals-guardrails.ts` (12 goals, 20 guardrails) are unchanged.

### 3. Connectors

```prisma
/// A project's binding to one outside service (ADEV-269). `kind` and
/// `serviceKey` are strings, as RuntimeBinding's are, so a new kind is not
/// a migration.
model ProjectConnector {
  id            String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  projectId     String
  /// "metric" | "experiment" | "estimator"
  kind          String
  /// A key from the environment's service registry, or "custom".
  serviceKey    String
  name          String
  /// Only for serviceKey "custom", and only where the deployment allows it.
  endpointUrl   String?
  /// encryptField() output. Never returned by any route.
  credentialEnc String?
  config        Json?
  state         String    @default("ok")
  lastOkAt      DateTime?
  lastError     String?
  createdById   String
  createdAt     DateTime  @default(now())

  @@index([projectId, kind])
}
```

Per project, because goals are per project; `Integration` is per user and keyed by an enum.
Only the project's owner or an admin creates, edits or removes a connector
(`canUserManageProject`). Agents never do.

### 4. Estimates

```prisma
/// One estimate of what a task would do (ADEV-269). Append-only: the latest
/// row for a task is its current estimate, as TaskCostEvent is a ledger.
model TaskEstimate {
  id               String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  taskId           String
  projectId        String
  /// "builtin_llm" | "service:<key>" | "human"
  source           String
  contractVersion  String
  requestedById    String
  createdAt        DateTime @default(now())
  inputsDigest     String

  /// [{ goalId, delta, low, high, unit, kind: "absolute" | "relative" }]
  goalImpacts      Json
  /// [{ guardrailId, delta, low, high, breachProbability }]
  guardrailImpacts Json
  /// { level: "low" | "medium" | "high", score?, factors: string[] }
  risk             Json
  costMicrocents   BigInt?
  effortHours      Float?
  /// { count, unit, period, share? }
  reach            Json?
  /// "low" | "medium" | "high"
  confidence       String
  rationale        String?

  /// Written by the server when it evaluates the policy. Never by a client.
  label            String?
  labelReasons     Json?
  sortKey          Json?
  policyDigest     String?

  @@index([taskId, createdAt])
}
```

- Cost also writes `Task.costEstimateMicrocents` with `costEstimateSource: 'model'`, only
  when no `human` value is there. Task cost keeps one home (TASK_COST_INTELLIGENCE.md).
- **Who writes:** the server, from a service reply; or a person, as `source: "human"`. An
  agent never writes an estimate. It may ask for one.
- "No arbitrary custom fields" (PROJECT_MODE.md) holds: every key here is the product's,
  and every id points at the project's own goals and guardrails.

### 5. Experiments and verification

```prisma
/// A task's link to an experiment, or to a plain post-deploy verification
/// window (ADEV-269). One table: both are "wait for a result, then settle".
model TaskExperiment {
  id               String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  taskId           String
  projectId        String
  /// "experiment" | "verification"
  kind             String
  connectorId      String?
  externalKey      String?
  url              String?
  /// "pending" | "running" | "concluded" | "stopped" | "unknown"
  state            String    @default("pending")
  /// "improving" | "flat" | "regressing" | "inconclusive"
  verdict          String?
  /// { action: "start" | "continue" | "stop" | "ship" | "rollback", reason }
  recommendation   Json?
  snapshot         Json?
  snapshotDigest   String?
  baseline         Json?
  startedAt        DateTime?
  decideBy         DateTime?
  fetchedAt        DateTime?
  returnAssigneeId String?

  @@index([taskId])
  @@index([state, fetchedAt])
}
```

A **verification** needs no experiment platform: it records the goal and guardrail values
at deploy (`baseline`) and compares them when `decideBy` comes, using the project's own
metric sources. That is how "is this deployment improving or not" is answered for a team
with metrics but no experiments.

---

## The three contracts

Astrid calls the service. All three share one envelope.

| | |
|---|---|
| Transport | JSON `POST` over HTTPS |
| Version | body field `contract`, e.g. `astrid.metric-source/v1`. Unknown fields are ignored; an unknown major version is refused |
| Auth | signed with `generateWebhookHeaders` (`lib/webhook-signature.ts`: `X-Astrid-Signature`, `X-Astrid-Timestamp`), plus an optional bearer credential from the connector |
| Outbound safety | a user-entered URL passes `assertPublicOutboundUrl` (`lib/security/outbound-url.ts`) |
| Limits | 10 s timeout, 256 KB response |
| Errors | 4xx: not retried, recorded in `lastError`. 429: `Retry-After` honoured. 5xx and timeouts: backoff through the Job queue (`lib/jobs/kinds.ts`) |
| Time | every value carries `at`. Past `staleAfterHours` the UI says stale and every rule reads the value as unknown |

### Metric source — `POST {base}/metrics/query`

```jsonc
// request
{ "contract": "astrid.metric-source/v1", "requestId": "…", "asOf": "2026-11-25T17:00:00Z",
  "metrics": [{ "key": "checkout_conversion", "window": "7d" }] }
// response
{ "metrics": [{ "key": "checkout_conversion", "status": "ok",   // | "no_data" | "unknown_metric"
    "value": 6.1, "unit": "%", "at": "2026-11-25T16:00:00Z",
    "series": [{ "at": "…", "value": 5.9 }],                    // optional, at most 60 points
    "url": "https://…" }] }
```

**Push is the route that exists.** `PUT /api/v1/projects/:id/goals/:goalId/measure` keeps
`{ current, taskId? }` and additionally accepts `{ value: number, unit?, at?, externalId? }`.
`externalId` makes a repeated push a no-op. A team whose analytics can call a webhook needs
no connector at all.

### Experiment source — `POST {base}/experiments/status`

```jsonc
// request: the goals and guardrails go with it, so the service can recommend against them
{ "contract": "astrid.experiment-source/v1", "requestId": "…",
  "experiments": [{ "key": "exp-412" }],
  "goals":      [{ "id": "g1", "metricKey": "checkout_conversion", "direction": "up", "target": 8 }],
  "guardrails": [{ "id": "r2", "metricKey": "p95_latency_ms", "op": "<=", "threshold": 400 }] }
// response
{ "experiments": [{ "key": "exp-412", "state": "running", "startedAt": "…", "url": "…", "at": "…",
    "arms": [{ "key": "control", "allocation": 0.5, "exposures": 10412 }],
    "metrics": [{ "metricKey": "checkout_conversion", "goalId": "g1",
                  "control": 6.0, "treatment": 6.4, "relDelta": 0.067,
                  "ci": [0.01, 0.12], "significant": true }],
    "verdict": "improving",
    "recommendation": { "action": "ship", "reason": "…" } }] }
```

Optional `POST {base}/experiments/action` with `{ key, action: "start" | "stop",
idempotencyKey, approvedBy }`. Astrid calls it only when the board's policy answers
`allowed`, or `ask` and a person approved. A service that omits it is read-only, and the
recommendation is shown for a person to carry out.

**Astrid computes no statistics.** Deltas, intervals and significance are the service's.
When a reply carries metrics but no `verdict`, Astrid derives one from `significant` and
`direction` only; with neither it is `inconclusive`.

### Estimator — `POST {base}/estimates`

```jsonc
// request
{ "contract": "astrid.estimator/v1", "requestId": "…",
  "idea": { "id": "…", "title": "…", "description": "…" },
  "goals": [{ "id": "g1", "statement": "…", "metricKey": "…", "unit": "%", "direction": "up",
              "target": 8, "current": 6.1 }],
  "guardrails": [{ "id": "r2", "statement": "…", "metricKey": "…", "op": "<=", "threshold": 400 }],
  "environment": { "kind": "software", "repository": "…" },     // optional, from connector config
  "want": ["goalImpacts", "guardrailImpacts", "risk", "cost", "reach"] }
// response: 200 with the result, or 202 { estimateId, pollAfterSeconds } then GET {base}/estimates/{id}
{ "goalImpacts": [{ "goalId": "g1", "delta": 0.4, "low": 0.1, "high": 0.9, "unit": "%", "kind": "absolute" }],
  "guardrailImpacts": [{ "guardrailId": "r2", "delta": 12, "low": 0, "high": 40, "breachProbability": 0.05 }],
  "risk": { "level": "medium", "score": 0.42, "factors": ["touches checkout", "schema change"] },
  "costMicrocents": 1800000000, "effortHours": 12,
  "reach": { "count": 41000, "unit": "users", "period": "month", "share": 0.31 },
  "confidence": "medium", "rationale": "…", "model": { "name": "…", "version": "…" } }
```

A service returns what it can. A missing section is "not estimated", and the policy treats
it as unknown.

### The built-in estimator

For a project with no estimator service. It implements the same contract in-process.

- **Call:** `callProvider` with `jsonOnly` (`lib/ai/providers/index.ts`), parsed with
  `extractBalancedJson` (`lib/ai/response-parser.ts`). Not a new raw `fetch`.
- **Whose model:** the list's `preferredAiProvider`, then the requester's
  `getPreferredAIService` and `getCachedModelPreference`, with the requester's own key
  (`getCachedApiKey`, `lib/api-key-cache.ts`). There is no deployment-hosted key. No key
  means the button explains how to add one.
- **Prompt:** the idea's title and description as delimited untrusted text
  (`lib/ai/prompt-trust.ts`), and the project's goals and guardrails with their measure,
  target and current value.
- **Output:** the estimator contract's shape, with `low` and `high` required.
- **Marked as rough, by the server, whatever the model says:** `confidence: "low"`,
  `source: "builtin_llm"`. The card shows ranges only under a "rough estimate" tag. Its
  label is capped at `experiment-first`. It never triggers an automatic action.

### Estimator output is untrusted data

- Ids are checked against the project's goals and guardrails; unknown ones are dropped.
- Numbers are clamped and strings capped.
- `rationale` renders as plain text. It reaches an agent prompt only as quoted data
  (`wrapUntrusted…` in `lib/ai/prompt-trust.ts`), never as instructions.

---

## 6. The trade-off policy

**The rule is astrid-core's** (`astrid_rules::tradeoff`, core-first; see the core's
`docs/GOAL_SIGNALS.md`). Web stores the policy, calls the rule on the server, and stores the
answer. It does not re-derive it.

**Shape.** A `tradeoff` section inside the orchestration policy
(`Project.orchestrationPolicy` / `TaskList.orchestrationPolicy`, resolved default → project
→ list like every other key):

```json
"tradeoff": {
  "goalOrder": ["g2", "g1"],
  "risk": { "reviewAt": "medium", "refuseAt": "high" },
  "guardrail": { "reviewAtBreachProbability": 0.1, "refuseAtBreachProbability": 0.5 },
  "experimentFirst": { "confidenceBelow": "medium", "riskAtLeast": "medium" },
  "minConfidenceToAct": "medium"
}
```

Thresholds, not a rule language: a rule language is a custom state machine by another name,
and PROJECT_MODE.md does not build those.

**Labels are fixed**, evaluated strictest first:

| Order | Condition | Label |
|---|---|---|
| 1 | Estimate missing, stale or unreadable | `needs-review` |
| 2 | A guardrail or the risk is at its refuse threshold | `dont` |
| 3 | A guardrail or the risk is at its review threshold | `needs-review` |
| 4 | Confidence is low, or the `experimentFirst` condition holds | `experiment-first` |
| 5 | Positive expected effect on at least one goal | `do-now` |
| 6 | Otherwise | `needs-review` |

Every label carries **reason lines** that name the number that produced it ("p95 latency:
breach probability 0.3 ≥ 0.1").

**The order is lexicographic, not a score:** label; then fewer guardrails at review; then
the impact band on each goal in `goalOrder`; then lower risk; then lower cost; then newest.
Nothing is multiplied, weighted or totalled, and no single number is stored or drawn.

**How this sits with DECISIONS.md rule 7** ("the grid does not decide; never add a score,
weight or total column"). The decision grid is untouched. The policy is the owner's rule
stated in advance and applied the same way to every idea; it explains itself in reason
lines; a person can move any idea anywhere regardless of its label.

**Acting on a label.** Three new autonomy actions join merge, deploy, migrate, release and
spend (`lib/orchestration-autonomy.ts`, core `Action`):

| Action | What it permits | Default |
|---|---|---|
| `promoteIdea` | move a `do-now` idea from Ideas to Ready | `never` |
| `experimentStart` | call the experiment service's `start` | `never` |
| `experimentStop` | call the experiment service's `stop` | `never` |

- `ask` reuses `lib/approvals.ts`: a card bound to the action and to a 40-hex digest of the
  estimate or experiment snapshot. A newer snapshot needs a new card. `APPROVAL_ACTIONS`
  grows; the card format does not.
- An estimate below `minConfidenceToAct`, and any built-in estimate, never acts.
- `PolicyGuardrailCheck` covers the new actions with no change, being typed on
  `AutonomyField`.
- Only an owner or admin edits the policy. Agents never do.

**Evaluated on the server, on write.** When an estimate arrives or the policy changes, the
server runs the core rule and stores `label`, `labelReasons`, `sortKey`, `policyDigest` on
the estimate row. A policy edit enqueues a bounded re-evaluation of rows whose
`policyDigest` differs. The browser compares stored keys only, so the browser bundle gains
no rules.

**No policy stated: nothing is drawn.** No labels, no sort option.

---

## 7. The Pending results lane

A second opt-in preset beside `testing` (`lib/board-presets.ts`, core `PRESET_STATES`):
role `results`, named **Pending results**. The rules are core-first, modelled on the
Waiting lane's.

### A board has the column only if a person added it

Jon, 2026-11-25: "we should not insert the Pending results for all boards unless the user
configures a verification or experimentation column, but we should support it with easy
configuration out of the box."

**Nothing adds the column on its own.** Not turning the gate on, not adding a connector,
not linking a task to an experiment, not a new board, not a migration, not an agent. A
board's columns change only when its owner or an admin changes them.

**Adding it is one tap, from two places:**

- **Manage statuses.** "Pending results" is listed beside "Testing" among the presets a
  board can add (`availableBoardPresets`). It is listed only while the gate is on for the
  board's project; a column that refuses every entry helps nobody.
- **An offer where it becomes useful.** The first time a task on a board without the
  column is linked to an experiment or given a verification window, the experiment row
  shows one line to the board's owner or admin: "Hold tasks like this in a Pending results
  column until the result is in? Add column." One tap adds it, placed after Doing (after
  Testing where the board has it). Dismissing it is remembered per board, and the offer is
  not made again. Members who cannot edit the board's columns never see it.

There is nothing else to configure: the column works with whatever connectors and
verification the project already has. Removing it is the ordinary remove-a-status path;
tasks in it go where that path sends them, and their experiments stay linked.

**A board without the column loses the lane, not the results.** Experiments and
verification still link, refresh and report on the task: the experiment row, the verdict
and a system comment when a result arrives. The task follows the board's own flow, and
nothing completes it, moves it or hands it back by rule. P1 to P4 below apply only to a
task that is in the column.

### The rules

- **P1 — entry needs something to wait for:** an open `TaskExperiment`, or a verification
  with `decideBy` in the future. Otherwise the write is refused with
  `RESULTS_NEEDS_CONDITION`, the client's cue to show the picker (link an experiment, or
  "verify for N days"). Entry unassigns the task and remembers the holder, as Waiting does.
- **P2 — it passed:** verdict `improving`, or the verification window ended with no
  guardrail breached and no goal regressed. The task completes, with a system comment
  carrying the numbers and a goal measurement that names the task.
- **P3 — it did not:** `regressing`, `inconclusive` at `decideBy`, or a source silent past
  `decideBy`. The task is handed back to the policy's escalation target (Inbox, assigned)
  with a Decision: iterate, roll back, ship anyway. Rollback is never automatic.
- **P4 — not yet:** a stale source before the deadline stays put, and the card says "no
  data since …".

**Settle job:** `/api/cron/results-settle`, every 15 minutes, `requireCronSecret` and
`runCronJob`, a bounded stalest-first pass on the `lib/sync/github/sync-all-links.ts`
template. A manual Refresh on the task settles it at once. For a task outside the column
the same pass refreshes the result and records it, and changes nothing else. Metric sources bound to goals
are polled by the same template on their own route.

---

## Surfaces

Each is absent until its data exists (PROJECT_MODE.md: a project that states nothing draws
nothing).

- **Idea card and task detail — Estimate.** One button. A picker only when more than one
  estimator is configured.
- **Estimate card** (recharts, `CHART_SERIES_COLORS` from `lib/brand/colors`, the
  `ListInsightsPanel` pattern):
  - a range bar per goal and per guardrail, the target or threshold as a reference line;
  - a risk chip with its factors;
  - three tiles: **impact**, **cost**, **opportunity** (reach × impact, shown as a range);
  - source, confidence and age, always visible. A built-in estimate says "rough estimate".
- **Label chip** on the idea card, with its reason lines on hover or tap.
- **Sort:** a `Policy` entry in `SORT_BY_OPTIONS`
  (`components/list-settings/filter-options.tsx`), offered only when a policy is stated.
- **`ProjectGoalsStrip`:** source name, "updated 3h ago" or "stale", a sparkline of history.
- **`ProjectGoalsEditor`:** the metric block and a source picker.
- **Goal chips** on task detail and list settings, to link and unlink.
- **Task detail — experiment row:** state, verdict, per-metric deltas, the recommendation,
  a link out, Refresh.
- **`OrchestrationPolicySection`:** the three new autonomy actions and the trade-off
  thresholds.
- **Project settings — Connections:** add, test and remove connectors.

All copy is i18n keys. Owner and admin checks use `lib/list-permissions.ts`.

## API

Under `/api/v1`, each behind the gate unless marked.

| Route | Does |
|---|---|
| `GET/PUT/DELETE tasks/:id/goals` (Project Mode only) | a task's links |
| `GET/PUT/DELETE lists/:id/goal-links` (Project Mode only) | a list's links |
| `PUT projects/:id/goals/:goalId/measure` (existing; extended) | push a measurement |
| `GET/POST projects/:id/connectors`, `PATCH/DELETE …/:connectorId`, `POST …/:connectorId/test` | connectors |
| `POST tasks/:id/estimates` | request an estimate (`{ connectorId? }`; none = built-in) or record a human one |
| `GET tasks/:id/estimates` | latest, and history |
| `GET/POST/DELETE tasks/:id/experiment`, `POST …/refresh` | link, read, refresh |

`docs/API_CONTRACT.md` is updated in the PR that adds each route.

## MCP and agents

New tools: `link_task_goal`, `get_task_estimate`, `request_estimate`,
`link_task_experiment`, `get_experiment_status`.

| An agent may | An agent may not |
|---|---|
| link a task to a goal or an experiment | write an estimate |
| read links, estimates, labels, results | write or edit a policy |
| push a measurement (as today) | create or edit a connector or a metric binding |
| request an estimate from an external service | request a built-in estimate unless `spend` allows |

Labels and estimates join `projectGoals` on the agent payloads, wrapped as untrusted data.
They steer; they do not gate, except through the autonomy actions above.

## Gating

Two layers, the capability first, as everywhere (`lib/brand/capabilities.ts`, then
`lib/feature-flags.ts`).

- **Capability** `goalSignals`, from `NEXT_PUBLIC_BRAND_ENABLE_GOAL_SIGNALS`,
  `explicitlyEnabled` (off unless set). It requires `projectMode`. Off → 404.
- **Flag** `goal_signals` in `FEATURE_KEYS`. `lib/goal-signals.ts` copies
  `lib/task-cost.ts` (`canUseGoalSignals`, `goalSignalsGate`). Off → 403 `not_granted`,
  which the client turns into the request-access UI.
- **The environment defines the services** (server-only, registered in `lib/env.ts`):
  - `ASTRID_SIGNAL_SERVICES`: JSON `[{ key, kind, name, baseUrl, secretEnv }]`.
  - `ASTRID_SIGNALS_BUILTIN_ESTIMATOR`: on by default.
  - `ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS`: off by default. On, a project owner may enter
    a URL, which then passes the outbound guard.
- `/api/v1/capabilities` publishes `goalSignals: { metricSources, experimentSources,
  estimators, customEndpoints }` so a client offers only what exists.
- **Not gated:** goal links and the typed measure. They need only Project Mode.

---

## What this is NOT

- **Not goals above projects.** One goal, one project.
- **Not vendor adapters.** No GA4, PostHog, Statsig or GrowthBook code in the first release.
- **Not an experiment engine.** No assignment, exposure logging or statistics in Astrid.
- **Not a score.** No combined number, weights, or user-defined rule language.
- **Not custom fields.** Every key is defined here.
- **Not automatic rollback.**
- **Not agent-written** goals, guardrails, policies, connectors or estimates.
- **Not a hosted model.** The built-in estimator uses the requester's own key.
- **Not a change to `testing`** or to the decision grid.
- **Not a new default column.** No board gains Pending results unless its owner or an
  admin adds it.

## Risks

| Risk | Answer |
|---|---|
| An older client's goals PUT unbinds a metric source | preserve-on-omit ships first (task 1a) |
| False precision from the built-in estimator | ranges only, confidence forced low, label capped, never acts |
| Estimator text steering an agent | validated ids, clamped numbers, rationale quoted as data |
| SSRF or a leaked credential through a custom endpoint | environment-defined services by default; outbound guard; credential encrypted, never returned |
| Labels stale after a policy edit | re-evaluation keyed on `policyDigest` |
| An approval card now binds a snapshot, not a commit | said here and in `docs/API_CONTRACT.md` when 6a lands |
| Policy sort is web-only at first | older clients read it as `auto` |

## Sequencing

One PR per repo per row. "Core first" follows astrid-core's CONTRACTS.md §7 for core-first
rules: the core PR and its fixtures land, then web re-pins and mirrors.

| # | Task | Order | After |
|---|---|---|---|
| 1a | Goal metric block, numeric measure, preserve-on-omit | web first | — |
| 1b | Core goals service keeps `metric` | core | 1a |
| 1c | `GoalLink`, routes, `GOAL:` ingest, backfill, `workByGoal` | web | — |
| 1d | Goal chips on tasks and lists; strip freshness | web | 1a, 1c |
| 2a | Gate, service registry, capabilities | web | — |
| 2b | `ProjectConnector`, metric-source client, metric guardrail check, poll job (**built**, ADEV-277) | web | 1a, 2a |
| 3a | `TaskEstimate`, estimator client, built-in estimator | web | 2a |
| 3b | One-tap Estimate and the estimate card | web | 3a |
| 4a | Trade-off rule, new autonomy actions, policy sort, fixtures | core first | — |
| 4b | Re-pin, evaluate on write, sort option, policy editor | web | 4a, 3a |
| 5a | `results` preset and lane rules, fixtures | core first | — |
| 5b | `TaskExperiment`, experiment client, settle job, lane wiring | web | 5a, 2a |
| 5c | Experiment row, lane cards, the one-tap "Add column" offer | web | 5b |
| 6a | Acting on labels: approvals for the three new actions | web | 4b, 5b |
| 6b | MCP tools | web | 3a, 5b |
| 7 | Native clients read links, estimates and results | core, then clients | 6a, 6b |

Phases 1 and 2a are useful alone: linked goals with real numbers. 3 adds estimates, 4 the
policy, 5 the results lane, 6 automation.
