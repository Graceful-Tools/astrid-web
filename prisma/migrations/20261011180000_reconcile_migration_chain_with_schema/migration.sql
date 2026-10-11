-- AWTD-1199: bring a database built from this chain to what schema.prisma
-- describes — and what production already has.
--
-- `prisma migrate diff` between a freshly migrated database and schema.prisma
-- was not empty: three changes had reached production by another route (db
-- push, or SQL run by hand) and the schema was updated to match while no
-- migration was written. Production's catalog was read on 2026-10-11 and agrees
-- with the schema on every one, so the chain is the side being corrected.
--
-- ON PRODUCTION THIS FILE CHANGES NOTHING. Every statement is guarded, and each
-- guard is false there. It exists for every OTHER database — CI, a new
-- developer's, a restore replayed from migrations — which until now came out
-- with a different Task index and without two columns the application writes.
--
-- 1. Task. 20260704060000 created an index on (completed, completedAt). The
--    schema never declared it and production does not have it. What the schema
--    declares, and production uses (9,613 scans when read), is
--    (creatorId, createdAt), which no migration created.
DROP INDEX IF EXISTS "Task_completed_completedAt_idx";
CREATE INDEX IF NOT EXISTS "Task_creatorId_createdAt_idx" ON "Task"("creatorId", "createdAt");

-- 2. WebAuthnChallenge.createdAt. The table is short-lived challenges, so the
--    default backfilling existing rows with "now" loses nothing.
ALTER TABLE "WebAuthnChallenge" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. SecureFile.chatMessageId. 20260328_add_chat_channel_and_message created
--    ChatMessage but not the column that attaches a file to one, nor its index
--    or foreign key.
ALTER TABLE "SecureFile" ADD COLUMN IF NOT EXISTS "chatMessageId" TEXT;
CREATE INDEX IF NOT EXISTS "SecureFile_chatMessageId_idx" ON "SecureFile"("chatMessageId");

-- ADD CONSTRAINT has no IF NOT EXISTS, and adding it twice is an error that
-- would block every migration behind this one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SecureFile_chatMessageId_fkey' AND conrelid = '"SecureFile"'::regclass
  ) THEN
    ALTER TABLE "SecureFile" ADD CONSTRAINT "SecureFile_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
