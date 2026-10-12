-- AWTD-1111 (P3a): GitHub App installations, their repos, and who may act on
-- them. Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §7.2–7.3.
--
-- Additive only. GitHubIntegration stays and is still written (dual-write)
-- until P3b moves its remaining readers; dropping it or its dead columns is a
-- destructive migration and takes two deploys (AWTD-959).

CREATE TABLE "GitHubInstallation" (
    "id" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT,
    "accountNodeId" TEXT,
    "repositorySelection" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubInstallationRepo" (
    "repoId" BIGINT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT false,
    "nodeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallationRepo_pkey" PRIMARY KEY ("repoId")
);

CREATE TABLE "GitHubInstallationAccess" (
    "userId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'verified',

    CONSTRAINT "GitHubInstallationAccess_pkey" PRIMARY KEY ("userId","installationId")
);

CREATE UNIQUE INDEX "GitHubInstallation_accountNodeId_key" ON "GitHubInstallation"("accountNodeId");
CREATE UNIQUE INDEX "GitHubInstallationRepo_nodeId_key" ON "GitHubInstallationRepo"("nodeId");
CREATE INDEX "GitHubInstallationRepo_installationId_idx" ON "GitHubInstallationRepo"("installationId");
CREATE INDEX "GitHubInstallationRepo_fullName_idx" ON "GitHubInstallationRepo"("fullName");
CREATE INDEX "GitHubInstallationAccess_installationId_idx" ON "GitHubInstallationAccess"("installationId");

ALTER TABLE "GitHubInstallationRepo" ADD CONSTRAINT "GitHubInstallationRepo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationAccess" ADD CONSTRAINT "GitHubInstallationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationAccess" ADD CONSTRAINT "GitHubInstallationAccess_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill from GitHubIntegration ─────────────────────────────────────────
-- Each link's cached repo list carries the repos and, through "owner/repo",
-- the account login. Repos are attributed to the LINK's installation, not the
-- per-repo "installationId" in the JSON: repos added by the old webhook
-- handler were cached without one. Non-array or malformed JSON contributes
-- nothing rather than failing the migration — a failed migration blocks every
-- migration behind it.

WITH repo AS (
    SELECT gi."installationId",
           elem->>'id' AS id,
           COALESCE(elem->>'fullName', elem->>'full_name') AS "fullName",
           COALESCE(NULLIF(COALESCE(elem->>'defaultBranch', elem->>'default_branch'), ''), 'main') AS "defaultBranch",
           COALESCE(elem->>'private', 'false') = 'true' AS "private"
    FROM "GitHubIntegration" gi
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(gi."repositories"::jsonb) = 'array' THEN gi."repositories"::jsonb ELSE '[]'::jsonb END
    ) AS elem
    WHERE gi."installationId" IS NOT NULL
      AND jsonb_typeof(elem) = 'object'
)
INSERT INTO "GitHubInstallation" ("id", "accountLogin", "updatedAt")
SELECT gi."installationId",
       COALESCE(
           (SELECT split_part(r."fullName", '/', 1) FROM repo r
             WHERE r."installationId" = gi."installationId" AND r."fullName" LIKE '%/%'
             ORDER BY r."fullName" LIMIT 1),
           'unknown'
       ),
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "installationId" FROM "GitHubIntegration" WHERE "installationId" IS NOT NULL) gi
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "GitHubInstallationRepo" ("repoId", "installationId", "fullName", "defaultBranch", "private", "updatedAt")
SELECT DISTINCT ON ((elem->>'id')::bigint)
       (elem->>'id')::bigint,
       gi."installationId",
       COALESCE(elem->>'fullName', elem->>'full_name'),
       COALESCE(NULLIF(COALESCE(elem->>'defaultBranch', elem->>'default_branch'), ''), 'main'),
       COALESCE(elem->>'private', 'false') = 'true',
       CURRENT_TIMESTAMP
FROM "GitHubIntegration" gi
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(gi."repositories"::jsonb) = 'array' THEN gi."repositories"::jsonb ELSE '[]'::jsonb END
) AS elem
WHERE gi."installationId" IS NOT NULL
  AND jsonb_typeof(elem) = 'object'
  AND (elem->>'id') ~ '^[0-9]+$'
  AND COALESCE(elem->>'fullName', elem->>'full_name') LIKE '%/%'
ORDER BY (elem->>'id')::bigint, gi."updatedAt" DESC
ON CONFLICT ("repoId") DO NOTHING;

-- The links in force today become access rows, marked 'legacy' so they are
-- distinguishable from access GitHub proved through the setup route. This
-- grants nothing new: these are exactly the installations each user's coding
-- agent already acts through.
INSERT INTO "GitHubInstallationAccess" ("userId", "installationId", "refreshedAt", "source")
SELECT DISTINCT gi."userId", gi."installationId", CURRENT_TIMESTAMP, 'legacy'
FROM "GitHubIntegration" gi
WHERE gi."installationId" IS NOT NULL
ON CONFLICT ("userId", "installationId") DO NOTHING;
