-- Drop dead residue left by the Projects-admin removal (board refactor).
--
-- 1. User.projectsBetaEnabled — the Projects Beta opt-in it gated was removed,
--    so the column has no read/write path anymore.
-- 2. InvitationType.PROJECT_SHARING — project-sharing invitations were removed;
--    the accept route no longer handles this variant. Verified 0 rows on prod
--    use it, so recreating the enum without it is safe.
--
-- NOTE: the Project / ProjectMember tables and TaskList.projectId are KEPT —
-- they are intentional plumbing that backs the per-list board and is read by
-- the iOS app via /api/v1.

-- Drop the now-unused Projects Beta opt-in flag.
ALTER TABLE "User" DROP COLUMN "projectsBetaEnabled";

-- Remove the now-unused PROJECT_SHARING invitation type. Postgres can't drop an
-- enum value in place, so recreate the type without it.
ALTER TABLE "Invitation" ALTER COLUMN "type" DROP DEFAULT;
ALTER TYPE "InvitationType" RENAME TO "InvitationType_old";
CREATE TYPE "InvitationType" AS ENUM ('TASK_ASSIGNMENT', 'LIST_SHARING', 'WORKSPACE_INVITE');
ALTER TABLE "Invitation" ALTER COLUMN "type" TYPE "InvitationType" USING ("type"::text::"InvitationType");
ALTER TABLE "Invitation" ALTER COLUMN "type" SET DEFAULT 'TASK_ASSIGNMENT';
DROP TYPE "InvitationType_old";
