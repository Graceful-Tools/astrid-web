-- ADEV-278: append-only task estimates. Additive only: one new table.

-- CreateTable
CREATE TABLE "TaskEstimate" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputsDigest" TEXT NOT NULL,
    "goalImpacts" JSONB NOT NULL,
    "guardrailImpacts" JSONB NOT NULL,
    "risk" JSONB NOT NULL,
    "costMicrocents" BIGINT,
    "effortHours" DOUBLE PRECISION,
    "reach" JSONB,
    "confidence" TEXT NOT NULL,
    "rationale" TEXT,
    "label" TEXT,
    "labelReasons" JSONB,
    "sortKey" JSONB,
    "policyDigest" TEXT,

    CONSTRAINT "TaskEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskEstimate_taskId_createdAt_idx" ON "TaskEstimate"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskEstimate" ADD CONSTRAINT "TaskEstimate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEstimate" ADD CONSTRAINT "TaskEstimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
