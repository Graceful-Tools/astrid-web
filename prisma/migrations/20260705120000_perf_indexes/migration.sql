-- Perf index gaps (review W4).
CREATE INDEX IF NOT EXISTS "Task_updatedAt_idx" ON "Task"("updatedAt");
CREATE INDEX IF NOT EXISTS "Task_completed_priority_createdAt_idx" ON "Task"("completed", "priority", "createdAt");
CREATE INDEX IF NOT EXISTS "ExternalTaskLink_userId_provider_remoteContainerId_idx" ON "ExternalTaskLink"("userId", "provider", "remoteContainerId");
