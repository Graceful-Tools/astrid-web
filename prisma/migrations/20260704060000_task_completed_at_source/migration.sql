-- Task completion timestamp + provenance (backdatable by external sync)
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "completedSource" TEXT;
CREATE INDEX "Task_completed_completedAt_idx" ON "Task"("completed", "completedAt");
