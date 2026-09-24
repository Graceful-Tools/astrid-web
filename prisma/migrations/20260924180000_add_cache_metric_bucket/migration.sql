-- Redis cache metrics buckets (AWTD-905).
--
-- Purely additive: a new table and its indexes, no change to any existing
-- column, so it is safe to apply to production during a deploy. Nothing reads
-- it until the admin analytics page ships, and nothing writes it until the
-- deploy carrying the RedisCache flush is live.

CREATE TABLE "CacheMetricBucket" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "instanceId" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "loads" INTEGER NOT NULL DEFAULT 0,
    "coalesced" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lookupMsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loadMsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "windows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacheMetricBucket_pkey" PRIMARY KEY ("id")
);

-- The upsert target: one row per hour per process.
CREATE UNIQUE INDEX "CacheMetricBucket_bucketStart_instanceId_key" ON "CacheMetricBucket"("bucketStart", "instanceId");

-- Serves both the report's range read and the retention delete.
CREATE INDEX "CacheMetricBucket_bucketStart_idx" ON "CacheMetricBucket"("bucketStart");
