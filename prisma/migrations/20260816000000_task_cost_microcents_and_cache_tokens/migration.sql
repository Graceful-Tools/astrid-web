-- Task Cost Intelligence, phase 1 storage shape (task 315949e1).
--
-- Jon answered the two questions phase 0 deliberately left open:
--   unit        -> microcents as an integer
--   cache reads -> "Store them separately"
--
-- SAFE TO RENAME rather than add-and-backfill because both are provably
-- empty in production, checked before writing this:
--   SELECT COUNT(*) FROM "TaskCostEvent"                            -> 0
--   SELECT COUNT(*) FROM "Task" WHERE "costEstimateCents" IS NOT NULL -> 0
-- Phase 0 shipped the columns behind a flag that was never turned on, so
-- there are no numbers to convert and no risk of a half-converted ledger.
-- If either had rows, this would have to be add-column + backfill + drop
-- across two deploys instead.

-- Cents rounds a typical call to zero: model prices are quoted per million
-- tokens. Microcents (1 dollar = 100,000,000) keeps small costs exact and
-- still sums without float drift.
ALTER TABLE "Task" RENAME COLUMN "costEstimateCents" TO "costEstimateMicrocents";
ALTER TABLE "TaskCostEvent" RENAME COLUMN "costCents" TO "costMicrocents";

-- Cache reads are billed at roughly a tenth of ordinary input, and cache
-- WRITES at a premium above it. Three counts are the only shape that prices
-- all three correctly; collapsing them would make the recorded cost wrong for
-- long agent runs with big cached prompts, which is most of the traffic worth
-- measuring.
--
-- DEFAULT 0 rather than nullable: zero cache tokens is a real, common
-- measurement, not missing data. Null would mean "we did not look".
ALTER TABLE "TaskCostEvent" ADD COLUMN IF NOT EXISTS "cacheReadTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TaskCostEvent" ADD COLUMN IF NOT EXISTS "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
