-- "Show list images" user preference. NULL = follow the hide_list_images
-- experiment; TRUE/FALSE = the user's explicit choice.
ALTER TABLE "User" ADD COLUMN "showListImages" BOOLEAN;

-- The hide_list_images experiment flag. Seeded OFF so this deploy changes
-- nothing visible; launching the A/B test is switching the rollout to
-- PERCENTAGE 50 in /admin/features/hide_list_images. The 50 is pre-filled so
-- that is one click.
INSERT INTO "FeatureFlag" ("id", "key", "displayName", "description", "enabled", "rolloutMode", "rolloutPercentage", "version", "updatedAt")
VALUES (
    'feature_hide_list_images',
    'hide_list_images',
    'Hide list images',
    'A/B test: hides list images in the sidebar, list header, list settings and public list browser. Users can turn them back on in Settings → Appearance.',
    true,
    'OFF',
    50,
    1,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- task_cost was added to FEATURE_KEYS without a seed row, so saving it from
-- the admin page threw "Missing seeded feature flag". Seeded OFF, which is
-- exactly how a missing row already evaluates.
INSERT INTO "FeatureFlag" ("id", "key", "displayName", "description", "enabled", "rolloutMode", "rolloutPercentage", "version", "updatedAt")
VALUES (
    'feature_task_cost',
    'task_cost',
    'Task cost',
    'Per-task cost tracking.',
    true,
    'OFF',
    0,
    1,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
