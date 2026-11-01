-- When each user's next daily / weekly digest is due (AWTD-1454), so the
-- reminders cron selects only the rows that are due instead of scanning the
-- whole User table every run.
--
-- PURELY ADDITIVE: two nullable columns and their indexes, no default, no
-- backfill. Null means "not yet scheduled": the cron fills it in, a bounded
-- batch per run, so existing rows schedule themselves after deploy. Code that
-- predates it never selects these columns, so it is safe to apply ahead of the
-- code that reads them. ReminderSettings is small (one row per user), so the
-- plain CREATE INDEX lock is brief.

-- AlterTable
ALTER TABLE "ReminderSettings" ADD COLUMN     "nextDailyDigestAt" TIMESTAMP(3),
ADD COLUMN     "nextWeeklyDigestAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReminderSettings_nextDailyDigestAt_idx" ON "ReminderSettings"("nextDailyDigestAt");

-- CreateIndex
CREATE INDEX "ReminderSettings_nextWeeklyDigestAt_idx" ON "ReminderSettings"("nextWeeklyDigestAt");
