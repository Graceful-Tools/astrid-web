-- The generic durable job queue (AWTD-1460): work that must outlive the
-- request that asked for it (the Astrid chat handoff and @Astrid comment
-- replies first), drained by the minute cron and by after() following each
-- enqueue. Modelled on GitHubSyncJob.
--
-- PURELY ADDITIVE: one new table and its indexes. No existing table, column
-- or row is touched, so it is safe to apply ahead of the code that uses it,
-- and code that predates it never reads it.

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_doneAt_runAfter_idx" ON "Job"("doneAt", "runAfter");

