-- ADEV-277: a project's binding to one outside service. Additive only: one new table.

-- CreateTable
CREATE TABLE "ProjectConnector" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT,
    "credentialEnc" TEXT,
    "config" JSONB,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectConnector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectConnector_projectId_kind_idx" ON "ProjectConnector"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "ProjectConnector" ADD CONSTRAINT "ProjectConnector_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
