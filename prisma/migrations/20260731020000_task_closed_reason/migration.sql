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

-- Reporting reads "closed tasks, split by reason".
--
-- Deliberately a PLAIN index, not a partial one. The schema declares
-- `@@index([closedReason])`, and the production build runs `prisma migrate
-- deploy` followed by `prisma db push` (scripts/build-with-migrations.js). A
-- partial index here does not match what push expects, so push tries to create
-- the same name again and fails with "relation Task_closedReason_idx already
-- exists" on every deploy. The migration and the schema have to agree.
CREATE INDEX "Task_closedReason_idx" ON "Task"("closedReason");
