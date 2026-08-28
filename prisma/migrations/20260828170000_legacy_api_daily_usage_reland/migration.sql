-- Task 058d80ad (re-land of task 641a7615): durable telemetry for the legacy
-- /api/* surface.
--
-- WHY A NEW MIGRATION NAME: the original (20260803060000_legacy_api_daily_usage)
-- is recorded as APPLIED in production's _prisma_migrations (2026-08-10), but the
-- table itself was dropped during the outage cleanup and the ledger row left
-- behind. Re-adding the original folder would be silently skipped on deploy and
-- the table would never exist. A fresh name applies; IF NOT EXISTS makes it safe
-- on any environment where the table survived.
--
-- Purely additive: one new table, no changes to existing tables, no backfill.

CREATE TABLE IF NOT EXISTS "LegacyApiDailyUsage" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyApiDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegacyApiDailyUsage_day_route_method_platform_key"
    ON "LegacyApiDailyUsage"("day", "route", "method", "platform");

CREATE INDEX IF NOT EXISTS "LegacyApiDailyUsage_route_day_idx" ON "LegacyApiDailyUsage"("route", "day");

CREATE INDEX IF NOT EXISTS "LegacyApiDailyUsage_day_idx" ON "LegacyApiDailyUsage"("day");
