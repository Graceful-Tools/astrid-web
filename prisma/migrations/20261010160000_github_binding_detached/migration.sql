-- AWTD-1153 (P4e): a GitHub-bound board whose installation was uninstalled or
-- suspended. Additive and nullable; no existing row changes.
ALTER TABLE "GitHubProjectBinding" ADD COLUMN "detachedAt" TIMESTAMP(3);
