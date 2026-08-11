-- Per-list "show subtasks inline" toggle (task dce843a1).
--
-- DEFAULT true is load-bearing: every existing row must read back as "show",
-- or each list silently empties itself of subtasks on the deploy that adds
-- this column. Additive and backfilled by the default — no data rewrite.
ALTER TABLE "TaskList" ADD COLUMN IF NOT EXISTS "showSubtasks" BOOLEAN NOT NULL DEFAULT true;
