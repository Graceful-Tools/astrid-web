-- Task AWTD-562: board status becomes a STATE on the task.
--
-- Status was membership in a `listType: 'status'` TaskList. That model could
-- not be both per-user (or every picker filled with duplicate Ready/Doing/
-- Waiting) and shared (or two members of one board resolved different columns).
-- Both attempts to reconcile it shipped bugs. As a field on the shared task
-- both requirements hold, and "at most one status per task" becomes true by
-- construction instead of something a normalizer enforces and a migration
-- repairs.
--
-- ADDITIVE ONLY. The status lists and their memberships are deliberately left
-- in place: iOS still resolves board columns from them, so removing them here
-- would break the phone. Web reads the field from now on and writes both; the
-- lists get dropped in a follow-up once iOS reads the field too.

ALTER TABLE "Task" ADD COLUMN "statusRole" TEXT;
ALTER TABLE "Project" ADD COLUMN "customStates" JSONB;

-- Board queries filter by status.
CREATE INDEX "Task_statusRole_idx" ON "Task"("statusRole");

-- Backfill from the existing memberships so every card keeps its column.
--
-- A completed task is Done and must carry no status — the same invariant the
-- old model enforced — so those are excluded rather than given a stale role.
UPDATE "Task" t
SET "statusRole" = src."statusRole"
FROM (
    SELECT DISTINCT ON (tt."A") tt."A" AS task_id, l."statusRole"
    FROM "_TaskToTaskList" tt
    JOIN "TaskList" l ON l."id" = tt."B"
    WHERE l."listType" = 'status'
      AND l."statusRole" IS NOT NULL
    -- Deterministic if a task somehow holds two: lowest statusOrder wins,
    -- matching the tie-break the previous cleanup used.
    ORDER BY tt."A", l."statusOrder" NULLS LAST, l."id"
) src
WHERE t."id" = src.task_id
  AND t."completed" = false;
