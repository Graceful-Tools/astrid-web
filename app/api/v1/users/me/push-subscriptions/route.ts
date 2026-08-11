/**
 * GET/POST/DELETE /api/v1/users/me/push-subscriptions
 *
 * Web-push registrations for the signed-in user. Mirrors
 * /api/user/push-subscription (task 641a7615, decision 3A), with the resource
 * pluralised to match the rest of v1 and the fact that GET returns a list.
 *
 * Two pieces of legacy behaviour kept deliberately, both of which read as bugs
 * if you do not know them:
 *
 * - **DELETE deactivates, it does not delete.** The row survives with
 *   `isActive: false`, so a later re-subscribe to the same endpoint updates
 *   history rather than losing it. POST therefore has to set `isActive: true`
 *   on update, or a re-subscribe would appear to succeed and receive nothing.
 * - **The keys stay nested** (`{ endpoint, keys: { p256dh, auth } }`). That is
 *   what the browser's PushSubscription serialises to, and clients hand it
 *   straight over; flattening would make every caller unpack a W3C object.
 *
 * `p256dh` and `auth` are the payload-encryption secrets and are write-only —
 * GET never returns them.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.push-subscriptions')

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  userAgent: z.string().optional(),
})

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.push-subscriptions' },
  async (_req, auth) => {
    try {
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId: auth.userId, isActive: true },
        select: {
          id: true,
          endpoint: true,
          userAgent: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({
        subscriptions,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error listing push subscriptions')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.push-subscriptions' },
  async (req, auth) => {
    try {
      const body = await req.json().catch(() => ({}))
      const data = PushSubscriptionSchema.parse(body)

      const subscription = await prisma.pushSubscription.upsert({
        where: { userId_endpoint: { userId: auth.userId, endpoint: data.endpoint } },
        update: {
          p256dh: data.keys.p256dh,
          auth: data.keys.auth,
          userAgent: data.userAgent,
          // Re-subscribing to a previously deactivated endpoint must bring it
          // back, or the browser registers happily and receives nothing.
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          userId: auth.userId,
          endpoint: data.endpoint,
          p256dh: data.keys.p256dh,
          auth: data.keys.auth,
          userAgent: data.userAgent,
          isActive: true,
        },
      })

      return NextResponse.json({
        id: subscription.id,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error saving push subscription')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.push-subscriptions' },
  async (req, auth) => {
    try {
      const endpoint = new URL(req.url).searchParams.get('endpoint')
      if (!endpoint) {
        return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
      }

      // Scoped to the caller: matching on endpoint alone would let anyone
      // silence another user's device by guessing it.
      const result = await prisma.pushSubscription.updateMany({
        where: { userId: auth.userId, endpoint },
        data: { isActive: false, updatedAt: new Date() },
      })

      return NextResponse.json({
        deactivated: result.count,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error deactivating push subscription')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
