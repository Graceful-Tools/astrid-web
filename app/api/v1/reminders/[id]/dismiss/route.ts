/**
 * POST /api/v1/reminders/:id/dismiss
 *
 * Dismiss a single reminder. With `{ dismissAll: true }` in the body,
 * dismisses all pending reminders for the same task and marks the task
 * `reminderSent: true`. Mirrors the legacy behavior.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.reminders.dismiss')

type RouteContext = { params: Promise<{ id: string }> }

const DismissSchema = z.object({
  dismissAll: z.boolean().optional().default(false),
})

export const POST = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.reminders.dismiss' },
  async (req, auth, { params }) => {
    try {
      const { id: reminderId } = await params

      const body = await req.text()
      const { dismissAll } = body ? DismissSchema.parse(JSON.parse(body)) : { dismissAll: false }

      const reminder = await prisma.reminderQueue.findUnique({ where: { id: reminderId } })
      if (!reminder) {
        return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
      }
      if (reminder.userId !== auth.userId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      let dismissedCount = 0

      if (dismissAll && reminder.taskId) {
        const taskReminders = await prisma.reminderQueue.findMany({
          where: { taskId: reminder.taskId, userId: auth.userId, status: 'pending' },
        })
        await prisma.reminderQueue.deleteMany({
          where: { taskId: reminder.taskId, userId: auth.userId, status: 'pending' },
        })
        dismissedCount = taskReminders.length
        await prisma.task.update({
          where: { id: reminder.taskId },
          data: { reminderSent: true },
        })
      } else {
        await prisma.reminderQueue.delete({ where: { id: reminderId } })
        dismissedCount = 1
        if (reminder.taskId) {
          const remaining = await prisma.reminderQueue.count({
            where: { taskId: reminder.taskId, userId: auth.userId, status: 'pending' },
          })
          if (remaining === 0) {
            await prisma.task.update({
              where: { id: reminder.taskId },
              data: { reminderSent: true },
            })
          }
        }
      }

      return NextResponse.json({
        success: true as const,
        dismissedCount,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error dismissing reminder')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
