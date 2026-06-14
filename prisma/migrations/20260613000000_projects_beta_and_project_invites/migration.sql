-- Projects (Beta) opt-in + project sharing via the existing Invitation system.
--
-- 1. Per-user opt-in flag for the Projects Beta surface (mirrors other
--    per-user boolean settings like smartTaskCreationEnabled).
-- 2. Extends the generic Invitation model to projects: a new PROJECT_SHARING
--    type and a projectId column, so inviting someone to a project reuses the
--    same token / email / accept plumbing as list sharing. On acceptance the
--    accept route upserts a ProjectMember (see app/api/invitations/[token]).

-- New per-user Beta flag (defaults off; users opt in via Settings).
ALTER TABLE "User" ADD COLUMN "projectsBetaEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Generic invitations can now target a project. No FK relation, matching the
-- existing taskId / listId columns (plain nullable strings).
ALTER TABLE "Invitation" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Invitation_projectId_idx" ON "Invitation"("projectId");

-- Add the PROJECT_SHARING variant. Safe to add in this migration because the
-- value is not referenced until a later transaction creates such invitations.
ALTER TYPE "InvitationType" ADD VALUE IF NOT EXISTS 'PROJECT_SHARING';
