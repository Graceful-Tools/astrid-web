-- Add an idempotency key to SecureFile so an offline upload retried by the iOS
-- Outbox doesn't create a duplicate file record. Additive + nullable: existing
-- rows and legacy (non-Outbox) uploads keep working with clientRequestId = NULL.
ALTER TABLE "SecureFile" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "SecureFile_clientRequestId_key" ON "SecureFile"("clientRequestId");
