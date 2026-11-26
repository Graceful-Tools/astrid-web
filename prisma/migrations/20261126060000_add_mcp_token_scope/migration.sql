-- AWTD-1567: explicit scopes for newly minted access tokens. Additive only: one
-- nullable column, no default, no backfill. Every existing token reads null
-- (unscoped) and keeps '*'.

-- AlterTable
ALTER TABLE "MCPToken" ADD COLUMN "scope" TEXT;
