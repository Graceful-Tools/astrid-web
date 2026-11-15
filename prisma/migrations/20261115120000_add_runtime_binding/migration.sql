-- AWTD-1666: explicit business runtime binding, schema only
-- (docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §4, §9 steps 1-2).
--
-- PURELY ADDITIVE. Three new, empty tables and one nullable column on
-- "TaskList" with no default and no backfill. No existing column, default,
-- constraint, index or row is changed, dropped or renamed. Nothing reads any
-- of it yet: schema ships before the code that reads it (RFC §9.2), and every
-- board's runtimeBindingId stays NULL, which means "today's resolver".
--
-- DELETION: every foreign key is ON DELETE RESTRICT. Deleting a binding's
-- owner fails until ownership is transferred; it never cascades a binding away
-- or nulls a board's association (a NULL would silently read as legacy mode).
--
-- LOCKING. Prisma applies a migration in one transaction, so a lock taken by
-- any statement is held until COMMIT. The "TaskList" statements therefore come
-- LAST, after the instant work on the new empty tables:
--   * ADD COLUMN, nullable, no default: catalog-only in every Postgres version
--     (no rewrite, no scan), but ACCESS EXCLUSIVE on "TaskList" until COMMIT.
--   * CREATE INDEX (not CONCURRENTLY; it cannot run in a transaction): one
--     scan of "TaskList" to index an all-NULL column.
--   * ADD FOREIGN KEY: one validating scan of "TaskList" (every value NULL, so
--     nothing to look up) and SHARE ROW EXCLUSIVE on "RuntimeBinding" (empty).
-- The "RuntimeBinding" -> "User" key validates against an empty table, so
-- "User" is locked (SHARE ROW EXCLUSIVE) only for the catalog update.

-- CreateTable
CREATE TABLE "RuntimeBinding" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "managementScope" TEXT NOT NULL,
    "runtimeKind" TEXT NOT NULL,
    "runtimeSubjectId" TEXT NOT NULL,
    "runtimeCustodianUserId" TEXT,
    "allowedAgentIds" TEXT[],
    "transport" TEXT NOT NULL,
    "endpointRef" TEXT,
    "credentialRef" TEXT,
    "allowedRepositoryRefs" TEXT[],
    "allowedBoardIds" TEXT[],
    "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 1,
    "billingSource" TEXT NOT NULL,
    "billingAccountRef" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "enrolledBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedRevision" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

CONSTRAINT "RuntimeBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeBindingRevision" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "RuntimeBindingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeBindingAuditEvent" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT,
    "bindingRevision" INTEGER,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorPrincipal" TEXT,
    "boardIds" TEXT[],
    "repositoryRefs" TEXT[],
    "reasonCode" TEXT,
    "details" JSONB,
    "correlationId" TEXT,
    "runId" TEXT,
    "transportOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "RuntimeBindingAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuntimeBinding_ownerUserId_idx" ON "RuntimeBinding"("ownerUserId");

-- CreateIndex
CREATE INDEX "RuntimeBinding_state_idx" ON "RuntimeBinding"("state");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeBindingRevision_bindingId_revision_key" ON "RuntimeBindingRevision"("bindingId", "revision");

-- CreateIndex
CREATE INDEX "RuntimeBindingAuditEvent_bindingId_createdAt_idx" ON "RuntimeBindingAuditEvent"("bindingId", "createdAt");

-- CreateIndex
CREATE INDEX "RuntimeBindingAuditEvent_createdAt_idx" ON "RuntimeBindingAuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "RuntimeBinding" ADD CONSTRAINT "RuntimeBinding_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeBindingRevision" ADD CONSTRAINT "RuntimeBindingRevision_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "RuntimeBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeBindingAuditEvent" ADD CONSTRAINT "RuntimeBindingAuditEvent_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "RuntimeBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "TaskList" last: see LOCKING above.
-- AlterTable
ALTER TABLE "TaskList" ADD COLUMN     "runtimeBindingId" TEXT;

-- CreateIndex
CREATE INDEX "TaskList_runtimeBindingId_idx" ON "TaskList"("runtimeBindingId");

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_runtimeBindingId_fkey" FOREIGN KEY ("runtimeBindingId") REFERENCES "RuntimeBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
