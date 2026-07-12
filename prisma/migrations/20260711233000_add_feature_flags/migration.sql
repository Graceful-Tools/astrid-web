CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutMode" TEXT NOT NULL DEFAULT 'OFF',
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureFlagTarget" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureFlagTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureFlagAudit" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureFlagAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");
CREATE UNIQUE INDEX "FeatureFlagTarget_featureFlagId_userId_key" ON "FeatureFlagTarget"("featureFlagId", "userId");
CREATE INDEX "FeatureFlagTarget_userId_idx" ON "FeatureFlagTarget"("userId");
CREATE INDEX "FeatureFlagAudit_featureFlagId_createdAt_idx" ON "FeatureFlagAudit"("featureFlagId", "createdAt");
CREATE INDEX "FeatureFlagAudit_changedByUserId_idx" ON "FeatureFlagAudit"("changedByUserId");
ALTER TABLE "FeatureFlagTarget" ADD CONSTRAINT "FeatureFlagTarget_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureFlagAudit" ADD CONSTRAINT "FeatureFlagAudit_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FeatureFlag" ("id", "key", "displayName", "description", "enabled", "rolloutMode", "rolloutPercentage", "version", "updatedAt")
VALUES ('feature_google_tasks', 'google_tasks', 'Google Tasks', 'Google Tasks account and list synchronization', false, 'OFF', 0, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
