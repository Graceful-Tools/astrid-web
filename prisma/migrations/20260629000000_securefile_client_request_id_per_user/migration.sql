-- Scope SecureFile idempotency to the uploader: a clientRequestId is unique per
-- user, not globally, so a client can't reuse another user's clientRequestId to
-- retrieve their file. NULL clientRequestId rows remain unconstrained.
DROP INDEX "SecureFile_clientRequestId_key";
CREATE UNIQUE INDEX "SecureFile_uploadedBy_clientRequestId_key" ON "SecureFile"("uploadedBy", "clientRequestId");
