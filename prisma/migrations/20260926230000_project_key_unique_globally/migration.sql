-- AWTD-1016: project keys are unique across astrid.cc, not per owner.
--
-- Task.identifier is globally unique, so a key two owners shared made every
-- task create in the second project fail on that index. Production had five
-- keyed projects and no duplicate key when this was written (2026-09-26). If a
-- duplicate has appeared since, the CREATE fails before the old index is
-- dropped, the deploy stops, and nothing is lost: re-key the newer project and
-- deploy again. NULL keys (projects from before identifiers) never conflict.

CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

DROP INDEX "Project_ownerId_key_key";
