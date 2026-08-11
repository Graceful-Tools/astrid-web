/**
 * GET/PUT /api/v1/users/me/default-due-time
 *
 * The user's default time-of-day for new due dates. Mirrors GET/PUT
 * /api/user/default-due-time (task 641a7615, decision 3A).
 *
 * Two deliberate differences from the legacy route:
 *
 * - the user is identified by `auth.userId`, not `session.user.email`. An
 *   OAuth token carries no email, so porting the email lookup would make this
 *   unusable by the callers v1 exists to serve — and an email lookup breaks
 *   anyway the moment someone changes theirs.
 * - `null` is accepted to clear the default, but an ABSENT key is rejected.
 *   Legacy's zod schema required the key too; treating a missing field as
 *   "clear it" would let an unrelated partial write wipe the setting.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.default-due-time')

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.default-due-time' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { defaultDueTime: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      return NextResponse.json({
        defaultDueTime: user.defaultDueTime,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching default due time')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.default-due-time' },
  async (req, auth) => {
    try {
      const body = await req.json().catch(() => ({}))

      // Present-and-valid, or nothing. `null` clears; absent is a bad request
      // rather than an implicit clear.
      if (!('defaultDueTime' in body)) {
        return NextResponse.json({ error: 'defaultDueTime is required' }, { status: 400 })
      }
      const value = body.defaultDueTime
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json(
          { error: 'defaultDueTime must be a string or null' },
          { status: 400 }
        )
      }

      const updated = await prisma.user.update({
        where: { id: auth.userId },
        data: { defaultDueTime: value },
        select: { defaultDueTime: true },
      })

      return NextResponse.json({
        defaultDueTime: updated.defaultDueTime,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error updating default due time')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
