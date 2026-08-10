-- Task 641a7615: durable telemetry for the legacy /api/* surface.
--
-- The retirement plan is data-driven -- "when residual traffic on a route drops
-- to zero, the route is safe to delete" -- and lib/api-deprecation.ts already
-- emits a structured line per legacy hit. But Vercel retains runtime logs for a
-- window of MINUTES; the best census anyone managed was ~2 minutes / 136 lines.
--
-- Acceptance requires a >=4-week window broken down by route x client. That
-- cannot come from logs, so the counts accumulate here instead.
--
-- Purely additive: one new table, no changes to existing tables, no backfill.

CREATE TABLE "LegacyApiDailyUsage" (
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

CREATE UNIQUE INDEX "LegacyApiDailyUsage_day_route_method_platform_key"
    ON "LegacyApiDailyUsage"("day", "route", "method", "platform");

CREATE INDEX "LegacyApiDailyUsage_route_day_idx" ON "LegacyApiDailyUsage"("route", "day");

CREATE INDEX "LegacyApiDailyUsage_day_idx" ON "LegacyApiDailyUsage"("day");
