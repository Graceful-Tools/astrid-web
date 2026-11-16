-- AWTD-1688: agent claim lease + heartbeat, and per-list claim enrollment.
-- Additive only: three nullable columns and an index on Task, one defaulted column on TaskList.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "claimLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "claimHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "claimHolderId" TEXT;

-- AlterTable
ALTER TABLE "TaskList" ADD COLUMN "agentClaimRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_claimLeaseExpiresAt_idx" ON "Task"("claimLeaseExpiresAt");
