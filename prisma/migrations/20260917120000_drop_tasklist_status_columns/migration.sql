-- Retire the vestigial TaskList status columns (AWTD-853, step 3 of 3).
--
-- Board status moved onto Task.statusRole in AWTD-562, and the Stage D
-- migration 20260821000000_drop_status_lists removed the status-list rows.
-- These four columns and the index over one of them are what was left behind.
--
-- STEP 1 shipped: AITD-376 landed on iOS, pinning that a list decodes with the
-- four fields absent.
-- STEP 2 shipped 2026-09-11: the v1 and legacy list routes stopped emitting
-- AND accepting them, pinned by tests/api/v1-list-status-fields-retired.test.ts.
-- Five days of soak since, with no decode problems reported.
--
-- WHAT THIS DESTROYS, checked against production rather than assumed:
-- 513 TaskList rows, of which THREE carry values — "Ready", "Doing" and
-- "Waiting", all listType='status' with projectId NULL, all created
-- 2026-08-21, the date of the Stage D migration. They are its leftovers. Their
-- values are the three defaults and are reproducible from DEFAULT_STATES in
-- lib/task-status.ts. statusCompleted is TRUE on no row at all.
--
-- Those three rows are NOT deleted here. Nothing reads them: the code filters
-- them by listType, never by these columns (see isProjectStatusList), so
-- dropping the columns changes nothing about how they are treated. Removing
-- the rows is a separate decision from removing the columns.
--
-- IRREVERSIBLE. There is no down migration; restoring these columns means
-- restoring from a backup.

-- The index depends on "statusOrder", so it goes first.
DROP INDEX IF EXISTS "TaskList_projectId_statusOrder_idx";

ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusRole";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusOrder";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusDescription";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusCompleted";
