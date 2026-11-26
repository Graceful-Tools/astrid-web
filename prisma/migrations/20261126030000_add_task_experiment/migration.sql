-- ADEV-279: a task's link to an experiment or a verification window. Additive only: one new table.

-- CreateTable
CREATE TABLE "TaskExperiment" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "connectorId" TEXT,
    "externalKey" TEXT,
    "url" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "verdict" TEXT,
    "recommendation" JSONB,
    "snapshot" JSONB,
    "snapshotDigest" TEXT,
    "baseline" JSONB,
    "startedAt" TIMESTAMP(3),
    "decideBy" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "returnAssigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskExperiment_taskId_idx" ON "TaskExperiment"("taskId");

-- CreateIndex
CREATE INDEX "TaskExperiment_state_fetchedAt_idx" ON "TaskExperiment"("state", "fetchedAt");

-- AddForeignKey
ALTER TABLE "TaskExperiment" ADD CONSTRAINT "TaskExperiment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskExperiment" ADD CONSTRAINT "TaskExperiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
