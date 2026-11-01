-- AWTD-1452: trigram indexes for search's ILIKE '%term%' predicates.
--
-- app/api/v1/search/route.ts matches `contains … mode: 'insensitive'` on
-- Task.title, Task.description and Comment.content. Prisma emits that as
-- ILIKE '%term%', which a B-tree cannot serve (leading wildcard), so every
-- search was a sequential scan. GIN + gin_trgm_ops serves ILIKE directly; the
-- planner BitmapOrs the two Task indexes and uses the Comment one inside the
-- EXISTS for `comments.some`.
--
-- ADDITIVE ONLY. Nothing is dropped, altered or rewritten. IF NOT EXISTS on
-- every statement so a partial apply can be re-run.
--
-- LOCKING: not CONCURRENTLY, because Prisma runs each migration inside a
-- transaction and CREATE INDEX CONCURRENTLY cannot run in one (same reason as
-- 20260908000000 and 20260911150000). A plain CREATE INDEX takes a SHARE lock:
-- reads carry on, writes to Task and Comment wait until each build finishes.
-- The build reads the table once; at Astrid's row counts that is seconds, not
-- minutes. If a table ever grows to where that matters, create the index by
-- hand CONCURRENTLY first — IF NOT EXISTS then makes this a no-op.
--
-- pg_trgm ships with Postgres contrib and is on Neon's supported list.
-- Searches for one or two characters produce no trigrams; the planner falls
-- back to a scan for those, which is no worse than before.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Task_description_idx" ON "Task" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Comment_content_idx" ON "Comment" USING GIN ("content" gin_trgm_ops);
