-- AWTD-1686: handoff as a command. Who held a task when it was handed off to
-- another list, so that when the other half completes and the task wakes from
-- Waiting (astrid-core Waiting rule R8), it goes back to that person or agent.
--
-- PURELY ADDITIVE. One nullable column on "Task", no default, no backfill, no
-- index, no foreign key (it is read only for the one task being woken, by id).
-- ADD COLUMN, nullable, no default, is catalog-only: no rewrite, no scan.
-- NULL means "nobody to return to", which is every existing row and every
-- task that was never handed off.
ALTER TABLE "Task" ADD COLUMN "handoffReturnAssigneeId" TEXT;
