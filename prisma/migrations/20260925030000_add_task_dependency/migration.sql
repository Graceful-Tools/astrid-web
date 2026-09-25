-- AWTD-1002: "waiting on tasks" — a task can be blocked on one or more others.
--
-- Purely additive: a new table with no backfill and no change to Task. Nothing
-- reads it until the feature writes rows, so applying this against production
-- changes no existing behaviour.

CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "blockedTaskId" TEXT NOT NULL,
    "blockingTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- Adding the same blocker twice is a no-op rather than a duplicate chip.
CREATE UNIQUE INDEX "TaskDependency_blockedTaskId_blockingTaskId_key"
    ON "TaskDependency"("blockedTaskId", "blockingTaskId");

-- The hot direction: "what did completing this task just unblock?"
CREATE INDEX "TaskDependency_blockingTaskId_idx" ON "TaskDependency"("blockingTaskId");

CREATE INDEX "TaskDependency_createdById_idx" ON "TaskDependency"("createdById");

ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockedTaskId_fkey"
    FOREIGN KEY ("blockedTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_blockingTaskId_fkey"
    FOREIGN KEY ("blockingTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not cascade: a departing user must not silently unblock the team's tasks.
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
