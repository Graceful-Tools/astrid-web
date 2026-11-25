-- ADEV-271: a task or a list serves one of its project's goals. Additive only: one new table.

-- CreateTable
CREATE TABLE "GoalLink" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "taskId" TEXT,
    "listId" TEXT,
    "source" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoalLink_projectId_goalId_idx" ON "GoalLink"("projectId", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalLink_taskId_projectId_goalId_key" ON "GoalLink"("taskId", "projectId", "goalId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalLink_listId_goalId_key" ON "GoalLink"("listId", "goalId");

-- AddForeignKey
ALTER TABLE "GoalLink" ADD CONSTRAINT "GoalLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalLink" ADD CONSTRAINT "GoalLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalLink" ADD CONSTRAINT "GoalLink_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
