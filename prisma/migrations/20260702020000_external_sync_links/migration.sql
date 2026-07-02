-- Multi-provider external sync: per-user credentials + list/task links.
CREATE TYPE "ExternalSyncProvider" AS ENUM ('APPLE_REMINDERS', 'GOOGLE_TASKS', 'GITHUB_ISSUES');
CREATE TYPE "ExternalSyncDirection" AS ENUM ('EXPORT', 'IMPORT', 'BIDIRECTIONAL');

CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ExternalSyncProvider" NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "externalAccountId" TEXT,
    "metadata" JSONB,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Integration_userId_provider_key" ON "Integration"("userId", "provider");
CREATE INDEX "Integration_userId_idx" ON "Integration"("userId");
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExternalListLink" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "astridListId" TEXT NOT NULL,
    "provider" "ExternalSyncProvider" NOT NULL,
    "remoteContainerId" TEXT NOT NULL,
    "remoteContainerName" TEXT,
    "direction" "ExternalSyncDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "includeCompleted" BOOLEAN NOT NULL DEFAULT true,
    "cursor" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalListLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalListLink_userId_astridListId_provider_key" ON "ExternalListLink"("userId", "astridListId", "provider");
CREATE INDEX "ExternalListLink_astridListId_idx" ON "ExternalListLink"("astridListId");
CREATE INDEX "ExternalListLink_integrationId_idx" ON "ExternalListLink"("integrationId");
ALTER TABLE "ExternalListLink" ADD CONSTRAINT "ExternalListLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalListLink" ADD CONSTRAINT "ExternalListLink_astridListId_fkey" FOREIGN KEY ("astridListId") REFERENCES "TaskList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExternalTaskLink" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "astridTaskId" TEXT NOT NULL,
    "provider" "ExternalSyncProvider" NOT NULL,
    "remoteId" TEXT NOT NULL,
    "remoteContainerId" TEXT NOT NULL,
    "astridUpdatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalTaskLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalTaskLink_userId_astridTaskId_provider_key" ON "ExternalTaskLink"("userId", "astridTaskId", "provider");
CREATE UNIQUE INDEX "ExternalTaskLink_provider_remoteId_userId_key" ON "ExternalTaskLink"("provider", "remoteId", "userId");
CREATE INDEX "ExternalTaskLink_astridTaskId_idx" ON "ExternalTaskLink"("astridTaskId");
CREATE INDEX "ExternalTaskLink_remoteContainerId_idx" ON "ExternalTaskLink"("remoteContainerId");
ALTER TABLE "ExternalTaskLink" ADD CONSTRAINT "ExternalTaskLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalTaskLink" ADD CONSTRAINT "ExternalTaskLink_astridTaskId_fkey" FOREIGN KEY ("astridTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
