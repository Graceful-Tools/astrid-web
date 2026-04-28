import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'

const log = createLogger('reminders.[id].snooze')


const SnoozeSchema = z.object({
  minutes: z.number().min(1).max(10080), // 1 minute to 1 week
})

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { minutes } = SnoozeSchema.parse(await request.json())

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

    // Check snooze limit
    const reminderData = reminder.data as any || {}
    const currentSnoozeCount = reminderData.snoozeCount || 0
    if (currentSnoozeCount >= 5) {
      return NextResponse.json(
        { error: 'maximum snooze limit reached (5 times)' },
        { status: 400 }
      )
    }

    // Calculate new scheduled time
    const newScheduledFor = new Date(Date.now() + minutes * 60 * 1000)

    // Update reminder
    const updatedReminder = await prisma.reminderQueue.update({
      where: { id: reminderId },
      data: {
        scheduledFor: newScheduledFor,
        retryCount: (reminder.retryCount || 0) + 1,
        status: 'pending',
        data: {
          ...reminderData,
          snoozedAt: new Date(),
          snoozeCount: currentSnoozeCount + 1,
          originalScheduledFor: reminderData.originalScheduledFor || reminder.scheduledFor,
        },
      },
    })

    return NextResponse.json({
      success: true,
      scheduledFor: updatedReminder.scheduledFor,
      snoozeCount: currentSnoozeCount + 1,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid snooze duration', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error snoozing reminder:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
