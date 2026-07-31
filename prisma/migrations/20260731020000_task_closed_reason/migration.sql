-- Task 11042ae3: a terminal state other than "done".
--
-- Task.completed is a boolean, so there was no way to close something as *not
-- done*. Users expressed "we're not doing this" by deleting the task, which
-- destroyed the title, the discussion, the decision, and any chance of
-- reporting on it.
--
-- One nullable column, no new entity and no backfill: null means "completed
-- normally, or still open", which is exactly what every existing row means.
-- Closing as canceled still sets completed = true, so every existing query,
-- view and filter keeps working untouched.

ALTER TABLE "Task" ADD COLUMN "closedReason" TEXT;

-- Reporting reads "closed tasks, split by reason". Partial index: the
-- overwhelming majority of rows are NULL and never need to be scanned.
CREATE INDEX "Task_closedReason_idx" ON "Task"("closedReason") WHERE "closedReason" IS NOT NULL;
