-- The GitHub issue field behind a project field (AWTD-1313). GitHub refuses
-- updateProjectV2ItemFieldValue for an issue field ("Target date", "Start
-- date"), which must be written with updateIssueFieldValue against the ISSUE
-- field's id. Null = an ordinary project field.
--
-- PURELY ADDITIVE: one nullable column, no default, no backfill. Code that
-- predates it never selects it by name, so it is safe to apply ahead of the
-- code that reads it. The next schema refresh fills it in.

-- AlterTable
ALTER TABLE "ProjectField" ADD COLUMN "issueFieldId" TEXT;
