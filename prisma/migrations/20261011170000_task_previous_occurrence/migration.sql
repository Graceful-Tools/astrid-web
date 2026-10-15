-- AWTD-1118 P6b: recurrence on a GitHub board spawns the next occurrence as a
-- NEW issue linked to the one just completed (spec §10), so a repeating series
-- there is a chain of tasks rather than one row rolled forward.
--
-- Additive and nullable; no existing row changes, and nothing is backfilled —
-- every task that predates this was in roll-forward mode, where the column has
-- no meaning. SET NULL on delete, not CASCADE: deleting a predecessor must not
-- destroy the occurrence that replaced it, because the series lives on the
-- newest one.
ALTER TABLE "Task" ADD COLUMN "previousOccurrenceId" TEXT;

CREATE INDEX "Task_previousOccurrenceId_idx" ON "Task"("previousOccurrenceId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_previousOccurrenceId_fkey" FOREIGN KEY ("previousOccurrenceId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
