-- Task dd7172d8: put Project Mode (projects + status boards) behind a request
-- form and an admin opt-in, so we can measure how many people actually want it.

CREATE TABLE "FeatureAccessRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "useCase" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureAccessRequest_pkey" PRIMARY KEY ("id")
);

-- One row per person per feature: asking twice is one data point, not two.
CREATE UNIQUE INDEX "FeatureAccessRequest_userId_featureKey_key"
    ON "FeatureAccessRequest"("userId", "featureKey");
CREATE INDEX "FeatureAccessRequest_featureKey_status_createdAt_idx"
    ON "FeatureAccessRequest"("featureKey", "status", "createdAt");
CREATE INDEX "FeatureAccessRequest_userId_idx" ON "FeatureAccessRequest"("userId");

ALTER TABLE "FeatureAccessRequest" ADD CONSTRAINT "FeatureAccessRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the flag OFF for everyone. SELECTED_USERS rather than OFF because OFF is
-- absolute and ignores INCLUDE targets — an admin granting a request must
-- actually grant it, and with OFF the target would be silently ineffective.
INSERT INTO "FeatureFlag" ("id", "key", "displayName", "description", "enabled", "rolloutMode", "rolloutPercentage", "version", "updatedAt")
VALUES (
    'feature_project_mode',
    'project_mode',
    'Project Mode',
    'Projects and status boards. Request-gated: users ask, an admin grants.',
    true,
    'SELECTED_USERS',
    0,
    1,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- Grandfather everyone who already has a board. Revoking a working board would
-- be a punitive migration; these users keep what they have. They are marked
-- grandfathered so they are excluded from the demand count — they never asked.
INSERT INTO "FeatureAccessRequest" ("id", "userId", "featureKey", "status", "grandfathered", "createdAt", "updatedAt")
SELECT
    'grandfathered_project_mode_' || u.id,
    u.id,
    'project_mode',
    'GRANTED',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT p."ownerId" AS id FROM "Project" p
    UNION
    SELECT DISTINCT l."ownerId" AS id FROM "TaskList" l WHERE l."projectId" IS NOT NULL
) u
ON CONFLICT ("userId", "featureKey") DO NOTHING;

-- ...and give them the INCLUDE target that actually grants access.
INSERT INTO "FeatureFlagTarget" ("id", "featureFlagId", "userId", "treatment", "createdAt")
SELECT
    'grandfathered_pm_target_' || r."userId",
    'feature_project_mode',
    r."userId",
    'INCLUDE',
    CURRENT_TIMESTAMP
FROM "FeatureAccessRequest" r
WHERE r."featureKey" = 'project_mode' AND r."grandfathered" = true
ON CONFLICT ("featureFlagId", "userId") DO NOTHING;
