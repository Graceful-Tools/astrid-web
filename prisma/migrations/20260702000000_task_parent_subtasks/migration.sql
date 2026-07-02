-- Subtasks: parentTaskId self-relation on Task. SetNull on parent delete so
-- subtasks promote to top-level rather than being destroyed with the parent.
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
