-- AWTD-1149 (P4a): the GitHub Projects read-only mirror's tables and columns.
-- Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.5. Additive and nullable
-- (approved on AWTD-1099): nothing reads them until a brand enables
-- githubProjects, which astrid.cc never does (D5). The two unique indexes are on
-- brand-new columns, so every existing value is NULL and they build cheaply.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "githubUserId" INTEGER;

-- AlterTable
ALTER TABLE "TaskList" ADD COLUMN     "backend" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubInstallationId" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "remoteKind" TEXT,
ADD COLUMN     "remoteNodeId" TEXT,
ADD COLUMN     "remoteVersion" TEXT;

-- CreateTable
CREATE TABLE "GitHubProjectBinding" (
    "projectId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "projectNodeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "statusFieldId" TEXT,
    "statusOptionMap" JSONB NOT NULL,
    "priorityFieldId" TEXT,
    "priorityOptionMap" JSONB,
    "dueFieldId" TEXT,
    "estimateFieldId" TEXT,
    "defaultRepoNodeId" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubProjectBinding_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "GitHubProjectItem" (
    "itemNodeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubProjectItem_pkey" PRIMARY KEY ("itemNodeId")
);

-- CreateTable
CREATE TABLE "GitHubSyncJob" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubProjectBinding_projectNodeId_key" ON "GitHubProjectBinding"("projectNodeId");

-- CreateIndex
CREATE INDEX "GitHubProjectBinding_installationId_idx" ON "GitHubProjectBinding"("installationId");

-- CreateIndex
CREATE INDEX "GitHubProjectItem_taskId_idx" ON "GitHubProjectItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubProjectItem_projectId_taskId_key" ON "GitHubProjectItem"("projectId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubSyncJob_dedupeKey_key" ON "GitHubSyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "GitHubSyncJob_doneAt_runAfter_installationId_idx" ON "GitHubSyncJob"("doneAt", "runAfter", "installationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubUserId_key" ON "User"("githubUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_remoteNodeId_key" ON "Task"("remoteNodeId");

-- AddForeignKey
ALTER TABLE "GitHubProjectBinding" ADD CONSTRAINT "GitHubProjectBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubProjectItem" ADD CONSTRAINT "GitHubProjectItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "GitHubProjectBinding"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubProjectItem" ADD CONSTRAINT "GitHubProjectItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

