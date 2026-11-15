-- Which lists one person's project board shows as rows (AWTD-1660): saved per
-- person per project, so the choice follows them across devices.
--
-- PURELY ADDITIVE: one new table, its indexes and its foreign keys. No
-- existing table, column or row is touched, so it is safe to apply ahead of
-- the code that uses it, and code that predates it never reads it.

-- CreateTable
CREATE TABLE "ProjectBoardView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "listIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBoardView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBoardView_projectId_idx" ON "ProjectBoardView"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBoardView_userId_projectId_key" ON "ProjectBoardView"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "ProjectBoardView" ADD CONSTRAINT "ProjectBoardView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBoardView" ADD CONSTRAINT "ProjectBoardView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

