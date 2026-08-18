/**
 * The UI-test account on astrid.cc, and a session cookie for it.
 *
 *   npx tsx scripts/uitest-account.ts          # ensure the account, print a cookie
 *   npx tsx scripts/uitest-account.ts --cookie # print only the cookie (for CI/env)
 *
 * WHY THIS EXISTS. The iOS UI suite asserted almost nothing: every test that needed
 * a signed-in app skipped itself, so ~10 minutes per device produced eight checks of
 * the sign-in screen and a green tick. Jon, 2026-08-16: "Setup a test account on
 * Astrid.cc" — a real account on production, not a fixture.
 *
 * WHY A SCRIPT RATHER THAN A ONE-OFF. The session is a NextAuth JWT and it EXPIRES
 * (30 days). A token pasted into a test file would work until it silently did not,
 * and the failure would look exactly like the skip it replaced. Re-run this to mint
 * a fresh one; nothing about the account changes.
 *
 * SAFETY. This account is deliberately separate from any human's:
 *
 *   - its own user row, so a test that deletes everything deletes only its own;
 *   - `isActive` like any user, but it owns exactly one list, created here;
 *   - it is NOT added to Jon's boards, so a runaway test cannot touch real work.
 *
 * The app only ever uses this credential under `-uiTesting`, and the keychain still
 * reads empty there, so the real account remains unreachable from a test run.
 */

export {}

import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'
import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'
import {
  UITEST_ACCOUNT_EMAIL,
  UITEST_LIST_NAME,
  UITEST_FIXTURE_TASKS,
  assertUITestAccount,
  planFixtureReset,
} from '../lib/uitest-fixtures'

const EMAIL = UITEST_ACCOUNT_EMAIL
const NAME = 'UI Test'
const LIST_NAME = UITEST_LIST_NAME

/** Matches `session.maxAge` in lib/auth-config.ts. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** The cookie name the app sends and the server reads over HTTPS. */
const COOKIE_NAME = '__Secure-next-auth.session-token'

// Load .env.local before anything reads process.env.
//
// Without this the script found no NEXTAUTH_SECRET and exited 1, and `run-tests.sh --ui`
// treats a failed mint as "no session available" — so the WHOLE iOS UI suite ran signed out
// and reported "✓ UI tests passed (28 passed, 36 skipped)". Green, asserting nothing. That is
// the same failure this account was created to end (astrid-ios task b86c97c5).
loadScriptEnv()

/**
 * The DEPLOYED database, which is what this script targets — the app under UI test talks to
 * production, so a session minted against a local database names a user that production has
 * never heard of. `DATABASE_URL` on a developer machine points at localhost, so preferring the
 * prod URL is what the header above has always meant. An explicit `DATABASE_URL` in the
 * environment still wins, for the case where someone means it.
 */
const DATASOURCE_URL = process.env.UITEST_DATABASE_URL
  ?? process.env.DATABASE_URL_PROD
  ?? process.env.DATABASE_URL

const prisma = new PrismaClient({
  datasources: DATASOURCE_URL ? { db: { url: DATASOURCE_URL } } : undefined,
})

/**
 * Every query here names its columns instead of going through a Prisma model.
 *
 * This script targets the DEPLOYED database, and the generated client is built from the
 * checked-in schema, which runs ahead of it — `Task.costEstimateMicrocents` and
 * `User.taskDisplayMode` are both in the client and not in production today. A model-level
 * `findUnique` selects every column it knows about, so it fails on a column that has not
 * shipped, and it fails on a query that had nothing to do with the new field. Naming columns
 * keeps this working across that gap in both directions.
 */
async function ensureAccount(quiet: boolean): Promise<{ id: string; email: string | null; name: string | null }> {
  const found: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, email, name FROM "User" WHERE email = $1`, EMAIL)
  if (found.length) {
    if (!quiet) console.log(`• Account: ${EMAIL} (${found[0].id})`)
    return found[0]
  }

  const id = randomUUID()
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" (id, email, name, "emailVerified") VALUES ($1, $2, $3, NOW())`,
    id, EMAIL, NAME)
  if (!quiet) console.log(`✅ Created ${EMAIL} (${id})`)
  return { id, email: EMAIL, name: NAME }
}

/**
 * One list of its own, so the suite has somewhere to work that is not a real board.
 */
async function ensureList(userId: string, quiet: boolean): Promise<string> {
  const found: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "TaskList" WHERE "ownerId" = $1 AND name = $2 LIMIT 1`, userId, LIST_NAME)
  if (found.length) {
    if (!quiet) console.log(`• List: "${LIST_NAME}" (${found[0].id})`)
    return found[0].id
  }

  const id = randomUUID()
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TaskList" (id, name, "ownerId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`, id, LIST_NAME, userId)
  if (!quiet) console.log(`✅ Created list "${LIST_NAME}" (${id})`)
  return id
}

/**
 * Put the account back into a known state.
 *
 * Signing the suite in was necessary and not sufficient: on an empty account every data-driven
 * test took its "nothing to work with" branch and skipped, and the run still reported success.
 *
 * This is a RESET, not a top-up — the tests complete, duplicate and create tasks, so an account
 * that accumulates their leftovers gives a different starting state every run. The guard runs
 * first because the next statement deletes every task the account has.
 */
async function seedFixtures(userId: string, email: string | null, listId: string, quiet: boolean) {
  assertUITestAccount(email)

  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT t.id FROM "Task" t
       JOIN "_TaskToTaskList" m ON m."A" = t.id
       JOIN "TaskList" l ON l.id = m."B"
      WHERE l."ownerId" = $1`, userId)
  const plan = planFixtureReset(existing.map(t => t.id))

  for (const id of plan.delete) {
    await prisma.$executeRawUnsafe(`DELETE FROM "_TaskToTaskList" WHERE "A" = $1`, id)
    await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE id = $1`, id)
  }

  // Explicit columns rather than `prisma.task.create`. The generated client is built from the
  // checked-in schema, which currently carries a column production has not migrated yet
  // (`costEstimateMicrocents`), so a model-level insert names it and fails. Naming the columns
  // here keeps the seeder working against the deployed database, which is the one the iOS test
  // account actually lives on. Remove this note once the schema and production agree.
  for (const fixture of plan.create) {
    const taskId = randomUUID()
    // ASSIGNED, not merely created by, the account. The app's landing view is "My Tasks",
    // which filters on `assigneeId == currentUserId` — fixtures that only set `creatorId`
    // exist on the server and are invisible in the app, so the suite lands on an empty screen
    // and every test that taps a task row skips or fails. That is the bug one layer down from
    // "the account is empty", and it looks identical from the outside.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (id, title, priority, completed, "completedAt", "creatorId", "assigneeId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      taskId,
      fixture.title,
      fixture.priority,
      fixture.completed,
      fixture.completed ? new Date() : null,
      userId,
      userId
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_TaskToTaskList" ("A", "B") VALUES ($1, $2)`,
      taskId,
      listId
    )
  }

  if (!quiet) {
    console.log(`✅ Fixtures reset: removed ${plan.delete.length}, created ${plan.create.length}`)
  }
}

async function main() {
  const quiet = process.argv.includes('--cookie')
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    console.error('❌ NEXTAUTH_SECRET missing — cannot mint a session. Check .env.local.')
    process.exit(1)
  }

  const user = await ensureAccount(quiet)
  const listId = await ensureList(user.id, quiet)
  await seedFixtures(user.id, user.email, listId, quiet)

  const now = Math.floor(Date.now() / 1000)
  const exp = now + SESSION_MAX_AGE_SECONDS

  // Same claim shape `renewSessionToken` produces, so the server cannot tell this
  // apart from a token issued by a real sign-in.
  const token = await encode({
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: user.name,
      iat: now,
      exp,
      jti: randomUUID(),
    },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  const cookie = `${COOKIE_NAME}=${token}`

  if (quiet) {
    // Bare value, so callers can do: TOKEN=$(npx tsx scripts/uitest-account.ts --cookie)
    console.log(cookie)
    return
  }

  console.log('')
  console.log(`Session valid until ${new Date(exp * 1000).toISOString()}`)
  console.log('')
  console.log('Cookie header value (this is what the app stores):')
  console.log(cookie)
  console.log('')
  console.log('To run the iOS UI suite signed in:')
  console.log('  export ASTRID_UITEST_COOKIE="$(npx tsx scripts/uitest-account.ts --cookie)"')
  console.log('  cd ../astrid-ios && npm run test:ui')
}

main()
  .catch(error => {
    console.error('❌ uitest-account failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
