-- Tombstones for delta sync. Tasks and lists are hard-deleted, so an
-- incremental sync (updatedSince) could not tell clients that something had
-- disappeared; deleted rows lingered on screen until a full refetch.
--
-- audienceIds records who could see the entity when it was deleted, so each
-- client is only told about deletions it cares about.
CREATE TABLE "DeletionLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audienceIds" TEXT[],
    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeletionLog_entity_deletedAt_idx" ON "DeletionLog"("entity", "deletedAt");
CREATE INDEX "DeletionLog_deletedAt_idx" ON "DeletionLog"("deletedAt");
