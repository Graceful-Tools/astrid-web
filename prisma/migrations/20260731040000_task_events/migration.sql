-- Task 51a4b8ff: append-only task activity history.
--
-- There was no audit trail anywhere in the schema — Comment was the only
-- record of what happened to a task, so "who moved this to Doing, and when"
-- was unanswerable. That matters more here than in a conventional tracker
-- because AI agents mutate tasks autonomously.

CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from" JSONB,
    "to" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- The read pattern is "this task's history, newest last".
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");
-- "What has this agent been doing?" — the debugging query.
CREATE INDEX "TaskEvent_actorId_createdAt_idx" ON "TaskEvent"("actorId", "createdAt");
CREATE INDEX "TaskEvent_kind_createdAt_idx" ON "TaskEvent"("kind", "createdAt");

-- Cascade only from the task: events are append-only and outlive nothing else.
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
