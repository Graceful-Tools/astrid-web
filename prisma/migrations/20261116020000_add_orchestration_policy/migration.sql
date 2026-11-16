-- AWTD-1693: the orchestration policy, stored on the project and overridable per list.
-- Additive only: one nullable JSONB column on each table, no default, no backfill.
-- NULL means nothing stored, which resolves to astrid-core's default (today's behaviour).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "orchestrationPolicy" JSONB;

-- AlterTable
ALTER TABLE "TaskList" ADD COLUMN "orchestrationPolicy" JSONB;
