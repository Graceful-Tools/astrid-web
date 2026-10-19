-- One project-field filter per user per list, on a GitHub board (AWTD-1259).
-- Holds "<ProjectField.id>:<option or iteration id>"; null = no filter.
--
-- PURELY ADDITIVE: one nullable column, no default, no backfill. Code that
-- predates it never selects it by name, so it is safe to apply ahead of the
-- code that reads it.

-- AlterTable
ALTER TABLE "UserListViewPreference" ADD COLUMN "filterProjectField" TEXT;
