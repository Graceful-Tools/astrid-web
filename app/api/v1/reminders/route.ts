/**
 * Reminders API v1
 *
 * GET /api/v1/reminders - List the authenticated user's pending reminders
 *
 * Mirrors GET /api/reminders/status (legacy) — same response keys plus a
 * `meta` envelope. iOS migration: change the path + auth header; the
 * decoder is unchanged for the data fields. The `userEmail` debugging
 * query param from legacy is intentionally NOT carried over (it required
 * cross-user lookup which is OAuth-incompatible).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.reminders')

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.reminders' },
  async (req, auth) => {
    try {
      const { searchParams } = new URL(req.url)
      const type = searchParams.get('type')
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)

      const where: {
        userId: string
        status: string
        scheduledFor: { gte: Date }
        type?: string
      } = {
        userId: auth.userId,
        status: 'pending',
        scheduledFor: { gte: new Date() },
      }
      if (type) where.type = type

      const reminders = await prisma.reminderQueue.findMany({
        where,
        include: {
          task: {
            select: {
              id: true,
              title: true,
              description: true,
              dueDateTime: true,
              priority: true,
              completed: true,
              lists: { select: { name: true } },
            },
          },
        },
        orderBy: { scheduledFor: 'asc' },
        take: limit,
      })

      const formattedReminders = reminders.map(reminder => ({
        id: reminder.id,
        type: reminder.type,
        scheduledFor: reminder.scheduledFor,
        retryCount: reminder.retryCount,
        snoozeCount: ((reminder.data as { snoozeCount?: number } | null)?.snoozeCount) ?? 0,
        task: reminder.task ? {
          id: reminder.task.id,
          title: reminder.task.title,
          description: reminder.task.description,
          dueDateTime: reminder.task.dueDateTime,
          priority: reminder.task.priority,
          completed: reminder.task.completed,
          listNames: reminder.task.lists.map(list => list.name),
        } : null,
      }))

      const stats = await prisma.reminderQueue.groupBy({
        by: ['type'],
        where: {
          userId: auth.userId,
          status: 'pending',
          scheduledFor: { gte: new Date() },
        },
        _count: { type: true },
      })

      const summary = stats.reduce<Record<string, number>>((acc, stat) => {
        acc[stat.type] = stat._count.type
        return acc
      }, {})

      const headers: Record<string, string> = {}
      const deprecationWarning = getDeprecationWarning(auth)
      if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

      return NextResponse.json(
        {
          reminders: formattedReminders,
          summary,
          total: formattedReminders.length,
          meta: {
            apiVersion: 'v1' as const,
            authSource: auth.source,
          },
        },
        { headers }
      )
    } catch (error) {
      log.error({ err: error }, 'Error fetching reminders')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
