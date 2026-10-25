-- AWTD-1190 P6c-4: every assignee of a task, primary first (spec §8.5, §9.5).
-- Additive, with a constant default, so Postgres rewrites no row. Not backfilled:
-- readers derive the list as assigneeId, then these (lib/task-assignees.ts),
-- so a task that has only ever had assigneeId already reads as [assigneeId].
ALTER TABLE "Task" ADD COLUMN "assigneeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
