-- goal_signals feature flag (ADEV-272). Seeded OFF, which is how a missing row
-- already evaluates; the admin page needs the row to save it.
INSERT INTO "FeatureFlag" ("id", "key", "displayName", "description", "enabled", "rolloutMode", "rolloutPercentage", "version", "updatedAt")
VALUES (
    'feature_goal_signals',
    'goal_signals',
    'Goal signals',
    'Outside metric sources, experiments and impact estimates for project goals.',
    true,
    'OFF',
    0,
    1,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
