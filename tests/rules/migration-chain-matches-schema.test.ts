/**
 * RULE — what schema.prisma says exists, some migration must create.
 *
 * WHY THIS FILE EXISTS (AWTD-1199). `prisma migrate diff` between a database
 * built from prisma/migrations and schema.prisma was not empty on main. Three
 * things had reached production by another route — `db push`, or SQL run by
 * hand — and the schema was updated to match while the chain was not:
 *
 *   1. Task had an index on (creatorId, createdAt) that no migration created,
 *      and the chain left one on (completed, completedAt) that the schema and
 *      production both lacked.
 *   2. WebAuthnChallenge.createdAt was in the schema and in no migration.
 *   3. SecureFile.chatMessageId — column, index and foreign key — was in no
 *      migration at all.
 *
 * The first real replay then found two more nobody had listed: GitHubIntegration
 * was unique on userId alone in the chain and on (userId, installationId) in
 * the schema, and Comment's (parentCommentId, createdAt) index had no migration.
 *
 * Production matched the SCHEMA on every one (read from its catalog on
 * 2026-10-11), so the chain was the side that was wrong. That matters because
 * `prisma migrate dev` offers to "repair" a difference like this, and the
 * repair it writes is derived from whichever side it trusts.
 *
 * This is the half that runs without a database: it pins those three so the
 * reconciling migration cannot be dropped or half-reverted (the "three" above
 * are five here). The real check —
 * `prisma migrate diff --exit-code` against a migrated Postgres — lives in
 * tests/integration/postgres-risk.test.ts and runs in CI, where it catches the
 * next drift whatever it turns out to be.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'prisma/migrations')

/** Every migration's SQL in the order Prisma applies it. */
const chain = readdirSync(MIGRATIONS)
  .sort()
  .map(name => join(MIGRATIONS, name, 'migration.sql'))
  .filter(existsSync)
  .map(file => readFileSync(file, 'utf8'))
  .join('\n')

/** Position of the LAST match, or -1 — "does the chain end with this present?" */
function lastIndexOfPattern(pattern: RegExp): number {
  let last = -1
  for (const match of chain.matchAll(new RegExp(pattern.source, 'g'))) {
    last = match.index ?? last
  }
  return last
}

describe('the migration chain creates what schema.prisma declares (AWTD-1199)', () => {
  it('creates the Task (creatorId, createdAt) index', () => {
    expect(chain).toMatch(
      /CREATE INDEX (IF NOT EXISTS )?"Task_creatorId_createdAt_idx" ON ("public"\.)?"Task"\("creatorId", "createdAt"\)/,
    )
  })

  it('does not leave the Task (completed, completedAt) index behind', () => {
    const created = lastIndexOfPattern(/CREATE INDEX (IF NOT EXISTS )?"Task_completed_completedAt_idx"/)
    const dropped = lastIndexOfPattern(/DROP INDEX (IF EXISTS )?("public"\.)?"Task_completed_completedAt_idx"/)

    expect(created).toBeGreaterThan(-1)
    expect(dropped).toBeGreaterThan(created)
  })

  it('adds WebAuthnChallenge.createdAt', () => {
    expect(chain).toMatch(
      /ALTER TABLE ("public"\.)?"WebAuthnChallenge" ADD COLUMN (IF NOT EXISTS )?"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    )
  })

  it('adds SecureFile.chatMessageId with its index and foreign key', () => {
    expect(chain).toMatch(/ALTER TABLE ("public"\.)?"SecureFile" ADD COLUMN (IF NOT EXISTS )?"chatMessageId" TEXT/)
    expect(chain).toMatch(
      /CREATE INDEX (IF NOT EXISTS )?"SecureFile_chatMessageId_idx" ON ("public"\.)?"SecureFile"\("chatMessageId"\)/,
    )
    expect(chain).toMatch(
      /ADD CONSTRAINT "SecureFile_chatMessageId_fkey" FOREIGN KEY \("chatMessageId"\) REFERENCES ("public"\.)?"ChatMessage"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
    )
  })

  it('makes GitHubIntegration unique per (userId, installationId), not per user', () => {
    const created = lastIndexOfPattern(/CREATE UNIQUE INDEX (IF NOT EXISTS )?"GitHubIntegration_userId_key"/)
    const dropped = lastIndexOfPattern(/DROP INDEX (IF EXISTS )?("public"\.)?"GitHubIntegration_userId_key"/)

    expect(dropped).toBeGreaterThan(created)
    expect(chain).toMatch(
      /CREATE UNIQUE INDEX (IF NOT EXISTS )?"GitHubIntegration_userId_installationId_key" ON ("public"\.)?"GitHubIntegration"\("userId", "installationId"\)/,
    )
  })

  it('creates the Comment (parentCommentId, createdAt) index', () => {
    expect(chain).toMatch(
      /CREATE INDEX (IF NOT EXISTS )?"Comment_parentCommentId_createdAt_idx" ON ("public"\.)?"Comment"\("parentCommentId", "createdAt"\)/,
    )
  })
})
