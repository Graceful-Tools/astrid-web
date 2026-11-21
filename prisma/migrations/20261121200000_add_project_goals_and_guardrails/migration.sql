-- ADEV-179: a project's goals and guardrails, read by the people and agents working in it.
-- Additive only: one nullable JSONB column, no default, no backfill. NULL means nothing stated.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "goalsAndGuardrails" JSONB;
