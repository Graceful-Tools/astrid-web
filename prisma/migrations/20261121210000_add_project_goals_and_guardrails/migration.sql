-- ADEV-179: a project's goals and guardrails.
-- Additive only: one nullable JSONB column, no default, no backfill. NULL means nothing stated.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "goalsAndGuardrails" JSONB;
