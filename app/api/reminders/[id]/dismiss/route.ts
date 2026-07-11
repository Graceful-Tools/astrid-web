import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'

const log = createLogger('reminders.[id].dismiss')


const DismissSchema = z.object({
  dismissAll: z.boolean().optional().default(false),
})

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.text()
    const { dismissAll } = body ? DismissSchema.parse(JSON.parse(body)) : { dismissAll: false }

    // Find the reminder and verify ownership
    const { id: reminderId } = await context.params

    const reminder = await prisma.reminderQueue.findUnique({
      where: { id: reminderId },
    })

    if (!reminder) {
      return NextResponse.json(
        { error: 'Reminder not found' },
        { status: 404 }
      )
    }

    if (reminder.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    let dismissedCount = 0

    if (dismissAll && reminder.taskId) {
      // Dismiss all reminders for this task
      const taskReminders = await prisma.reminderQueue.findMany({
        where: {
          taskId: reminder.taskId,
          userId: session.user.id,
          status: 'pending',
        },
      })

      await prisma.reminderQueue.deleteMany({
        where: {
          taskId: reminder.taskId,
          userId: session.user.id,
          status: 'pending',
        },
      })

      dismissedCount = taskReminders.length

      // Update task to mark reminder as sent (dismissed)
      if (reminder.taskId) {
        await prisma.task.update({
          where: { id: reminder.taskId },
          data: { reminderSent: true },
        })
      }
    } else {
      // Dismiss only this specific reminder
      await prisma.reminderQueue.delete({
        where: { id: reminderId },
      })

      dismissedCount = 1

      // If this was the only pending reminder for the task, update task status
      if (reminder.taskId) {
        const remainingReminders = await prisma.reminderQueue.count({
          where: {
            taskId: reminder.taskId,
            userId: session.user.id,
            status: 'pending',
          },
        })

        if (remainingReminders === 0) {
          await prisma.task.update({
            where: { id: reminder.taskId },
            data: { reminderSent: true },
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      dismissedCount,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error dismissing reminder:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
