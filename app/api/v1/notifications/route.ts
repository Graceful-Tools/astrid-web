/**
 * Notification inbox (task ab0572cb).
 *
 * GET  /api/v1/notifications?unread=1 — the caller's inbox + unread count
 * PUT  /api/v1/notifications — mark read: { ids?: string[], all?: boolean }
 *
 * Rows are created by fan-out from TaskEvent; this endpoint only reads and
 * acknowledges them.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.notifications')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.notifications' },
  async (req, auth) => {
    const url = new URL(req.url)
    const unreadOnly = url.searchParams.get('unread') === '1'
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1),
      MAX_LIMIT
    )

    // Scoped to the caller by userId — a notification belongs to exactly one
    // person, so there is no cross-user read path to get wrong here.
    const where = { userId: auth.userId, ...(unreadOnly ? { readAt: null } : {}) }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          task: {
            select: { id: true, identifier: true, title: true, completed: true },
          },
        },
      }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
    ])

    return NextResponse.json({
      notifications,
      unreadCount,
      meta: { apiVersion: 'v1', authSource: auth.source },
    })
  }
)

export const PUT = withAuth(
  { scopes: ['user:read'], tag: 'v1.notifications' },
  async (req, auth) => {
    const body = await req.json().catch(() => ({}))
    const markAll = body.all === true
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown) => typeof id === 'string') : []

    if (!markAll && ids.length === 0) {
      return NextResponse.json({ error: 'Provide ids or all: true' }, { status: 400 })
    }

    try {
      // userId in the where clause is the authorization: a caller can only ever
      // mark their own notifications read, whatever ids they send.
      const result = await prisma.notification.updateMany({
        where: {
          userId: auth.userId,
          readAt: null,
          ...(markAll ? {} : { id: { in: ids } }),
        },
        data: { readAt: new Date() },
      })

      return NextResponse.json({ updated: result.count })
    } catch (error) {
      log.error({ err: error }, 'Failed to mark notifications read')
      return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
    }
  }
)
