-- AWTD-1592: the language a user reads, for copy rendered without a request
-- (push notifications, reminder and digest emails).
--
-- ADDITIVE ONLY. One nullable column, no default, no backfill: NULL reads as
-- English, which is what every one of these messages said before. Adding a
-- nullable column with no default is a catalog-only change in Postgres — no
-- table rewrite, a brief ACCESS EXCLUSIVE lock and no wait on row count.
-- IF NOT EXISTS so a partial apply can be re-run.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "locale" TEXT;
