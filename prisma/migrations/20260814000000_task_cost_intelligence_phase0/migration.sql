-- Task Cost Intelligence, phase 0 (task 315949e1).
--
-- Purely additive. Two nullable columns on "Task" and one new table; no
-- existing row is rewritten and no existing query changes meaning. A
-- deployment that never turns the feature on carries two always-null columns
-- and an empty table.
--
-- Nullable on purpose rather than DEFAULT 0: null means "never estimated",
-- which is the overwhelmingly common case and must draw no UI. A default of
-- zero would claim every task in the database was estimated at nothing.

-- Expected cost in cents at the time work was authorised.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "costEstimateCents" INTEGER;
-- How the estimate was produced: human | cohort | model.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "costEstimateSource" TEXT;

-- Append-only ledger of what a task actually cost.
--
-- costCents is stored, not derived: token counts are facts, money is a fact
-- about a price list that changes. Deriving it at read time would re-price
-- every historical task whenever a provider changed rates.
CREATE TABLE IF NOT EXISTS "TaskCostEvent" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "taskId"       TEXT NOT NULL,
    "aiAgentId"    TEXT,
    "provider"     TEXT NOT NULL,
    "model"        TEXT NOT NULL,
    "inputTokens"  INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costCents"    INTEGER NOT NULL,
    "externalId"   TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCostEvent_pkey" PRIMARY KEY ("id")
);

-- Deleting a task takes its cost events with it. The ledger is an audit trail
-- for a task that exists; orphaned rows keyed to a deleted task are not.
ALTER TABLE "TaskCostEvent"
    ADD CONSTRAINT "TaskCostEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotency: a retried report must not be counted twice. Unique per task
-- rather than globally, because two different tasks may legitimately be
-- reported under the same run id by different agents.
--
-- Postgres treats NULLs as distinct in a unique index, so events with no
-- externalId are unconstrained — which is correct: a reporter that supplies no
-- idempotency key has not asked for one.
CREATE UNIQUE INDEX IF NOT EXISTS "TaskCostEvent_taskId_externalId_key"
    ON "TaskCostEvent"("taskId", "externalId");

CREATE INDEX IF NOT EXISTS "TaskCostEvent_taskId_idx" ON "TaskCostEvent"("taskId");
CREATE INDEX IF NOT EXISTS "TaskCostEvent_aiAgentId_createdAt_idx"
    ON "TaskCostEvent"("aiAgentId", "createdAt");
