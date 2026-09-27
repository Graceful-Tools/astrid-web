-- AWTD-1024: a project key can be renamed after tasks exist. The old key is
-- kept here so `OLD-12` still resolves and can never name another task.
-- Additive only: a new, empty table.

CREATE TABLE "ProjectKeyAlias" (
    "key" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectKeyAlias_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ProjectKeyAlias_projectId_idx" ON "ProjectKeyAlias"("projectId");

ALTER TABLE "ProjectKeyAlias" ADD CONSTRAINT "ProjectKeyAlias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
