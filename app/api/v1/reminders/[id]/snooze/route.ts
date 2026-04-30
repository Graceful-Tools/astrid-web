/**
 * POST /api/v1/reminders/:id/snooze
 *
 * Snooze a single reminder by N minutes (1 minute to 1 week). Maxes out
 * at 5 snoozes per reminder — same limit as the legacy route.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.reminders.snooze')

type RouteContext = { params: Promise<{ id: string }> }

const SnoozeSchema = z.object({
  minutes: z.number().min(1).max(10080),
})

const MAX_SNOOZE_COUNT = 5

export const POST = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.reminders.snooze' },
  async (req, auth, { params }) => {
    try {
      const { id: reminderId } = await params
      const { minutes } = SnoozeSchema.parse(await req.json())

      const reminder = await prisma.reminderQueue.findUnique({ where: { id: reminderId } })
      if (!reminder) {
        return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
      }
      if (reminder.userId !== auth.userId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      const reminderData = (reminder.data as Record<string, unknown> | null) ?? {}
      const currentSnoozeCount = (reminderData.snoozeCount as number | undefined) ?? 0
      if (currentSnoozeCount >= MAX_SNOOZE_COUNT) {
        return NextResponse.json(
          { error: `maximum snooze limit reached (${MAX_SNOOZE_COUNT} times)` },
          { status: 400 }
        )
      }

      const newScheduledFor = new Date(Date.now() + minutes * 60 * 1000)

      const updated = await prisma.reminderQueue.update({
        where: { id: reminderId },
        data: {
          scheduledFor: newScheduledFor,
          retryCount: (reminder.retryCount || 0) + 1,
          status: 'pending',
          data: {
            ...reminderData,
            snoozedAt: new Date(),
            snoozeCount: currentSnoozeCount + 1,
            originalScheduledFor: reminderData.originalScheduledFor ?? reminder.scheduledFor,
          },
        },
      })

      return NextResponse.json({
        success: true as const,
        scheduledFor: updated.scheduledFor,
        snoozeCount: currentSnoozeCount + 1,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid snooze duration', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error snoozing reminder')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
