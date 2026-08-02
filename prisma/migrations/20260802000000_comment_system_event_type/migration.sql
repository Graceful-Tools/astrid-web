-- Task 59e2dcff: typed discriminator for system-authored comments.
--
-- The completion-streak fold on web, iOS and Mac all identify a completion
-- comment by pattern-matching the English string "marked this as complete".
-- Localising or rewording that sentence would silently break the feature on
-- every client at once. This column lets clients key off structure instead.

ALTER TABLE "Comment" ADD COLUMN "systemEventType" TEXT;

-- The fold reads "this task's system completion comments, in order".
CREATE INDEX "Comment_taskId_systemEventType_idx" ON "Comment"("taskId", "systemEventType");

-- Backfill from the existing prose so the fold works on historical comments
-- immediately rather than only on ones created from here on.
--
-- Deliberately narrow: only system comments (authorId IS NULL), and only where
-- the marker phrase appears. A user comment that happens to contain the phrase
-- must never be typed as a system event — that is exactly the kind of comment
-- the fold is required to leave alone.
UPDATE "Comment"
SET "systemEventType" = 'COMPLETED'
WHERE "authorId" IS NULL
  AND "systemEventType" IS NULL
  AND "content" LIKE '%marked this as complete%'
  AND "content" NOT LIKE '%marked this as incomplete%';

UPDATE "Comment"
SET "systemEventType" = 'REOPENED'
WHERE "authorId" IS NULL
  AND "systemEventType" IS NULL
  AND "content" LIKE '%marked this as incomplete%';
