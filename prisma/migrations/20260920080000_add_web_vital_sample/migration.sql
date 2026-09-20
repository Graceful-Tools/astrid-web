-- Core Web Vitals samples (AWTD-904).
--
-- Purely additive: a new table and its indexes, no change to any existing
-- column, so it is safe to apply to production during a deploy and nothing
-- reads it until the reporter ships.

CREATE TABLE "WebVitalSample" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "authState" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVitalSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebVitalSample_metric_createdAt_idx" ON "WebVitalSample"("metric", "createdAt");

CREATE INDEX "WebVitalSample_createdAt_idx" ON "WebVitalSample"("createdAt");

CREATE INDEX "WebVitalSample_route_metric_createdAt_idx" ON "WebVitalSample"("route", "metric", "createdAt");
