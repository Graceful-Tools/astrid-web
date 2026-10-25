-- AWTD-1112 (P3b): a slot in the encrypted Integration store for the GitHub
-- App's user-to-server token. Additive: nothing reads or writes GITHUB until
-- this deploy's code does, and the value is not used in this migration (a new
-- enum value cannot be used in the transaction that adds it).
ALTER TYPE "ExternalSyncProvider" ADD VALUE IF NOT EXISTS 'GITHUB';
