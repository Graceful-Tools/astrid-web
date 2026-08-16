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
import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'

const EMAIL = 'uitest@astrid.cc'
const NAME = 'UI Test'
const LIST_NAME = 'UI Test List'

/** Matches `session.maxAge` in lib/auth-config.ts. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** The cookie name the app sends and the server reads over HTTPS. */
const COOKIE_NAME = '__Secure-next-auth.session-token'

const prisma = new PrismaClient()

async function main() {
  const quiet = process.argv.includes('--cookie')
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    console.error('❌ NEXTAUTH_SECRET missing — cannot mint a session. Check .env.local.')
    process.exit(1)
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (!user) {
    user = await prisma.user.create({
      data: { email: EMAIL, name: NAME, emailVerified: new Date() },
    })
    if (!quiet) console.log(`✅ Created ${EMAIL} (${user.id})`)
  } else if (!quiet) {
    console.log(`• Account already exists: ${EMAIL} (${user.id})`)
  }

  // One list of its own, so the suite has somewhere to create tasks that is not a
  // real board. Tests that need an empty state can still make their own.
  const existingList = await prisma.taskList.findFirst({
    where: { ownerId: user.id, name: LIST_NAME },
  })
  if (!existingList) {
    const list = await prisma.taskList.create({
      data: { name: LIST_NAME, ownerId: user.id },
    })
    if (!quiet) console.log(`✅ Created list "${LIST_NAME}" (${list.id})`)
  } else if (!quiet) {
    console.log(`• List already exists: "${LIST_NAME}" (${existingList.id})`)
  }

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
