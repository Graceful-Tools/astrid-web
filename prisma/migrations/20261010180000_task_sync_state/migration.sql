-- AWTD-1116 P5b: a GitHub-backed task whose write-through is half done.
-- Additive and nullable; no existing row changes.
ALTER TABLE "Task" ADD COLUMN "syncState" TEXT;
