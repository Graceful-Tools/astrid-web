-- Comments mirrored with GitHub (AWTD-1283): the IssueComment's node id, and
-- the GitHub login of an author with no Astrid identity.
--
-- PURELY ADDITIVE: two nullable columns, no default, no backfill, and a unique
-- index that every existing row satisfies (all NULL). Code that predates it
-- never selects them by name, so it is safe to apply ahead of the code that
-- reads them.

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "remoteNodeId" TEXT;
ALTER TABLE "Comment" ADD COLUMN "remoteAuthorLogin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Comment_remoteNodeId_key" ON "Comment"("remoteNodeId");
