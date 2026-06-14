-- Make a list survive its project's deletion.
--
-- TaskList.project was ON DELETE CASCADE, so deleting a Project (directly in
-- the DB, Prisma Studio, raw SQL, etc.) would cascade-delete its attached
-- lists. The app's delete path detaches first, but the cascade is a footgun.
-- Switch to ON DELETE SET NULL so a deleted project simply detaches its lists
-- (projectId -> NULL); the lists and their tasks are preserved.

ALTER TABLE "TaskList" DROP CONSTRAINT "TaskList_projectId_fkey";
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
