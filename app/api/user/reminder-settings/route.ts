import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.reminder-settings')


const ReminderSettingsSchema = z.object({
  enablePushReminders: z.boolean().optional(),
  enableEmailReminders: z.boolean().optional(),
  defaultReminderTime: z.number().min(0).max(10080).optional(), // 0 to 7 days in minutes
  enableDailyDigest: z.boolean().optional(),
  dailyDigestTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(), // HH:MM format
  dailyDigestTimezone: z.string().optional(),
  quietHoursStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  // Calendar integration fields
  enableCalendarSync: z.boolean().optional(),
  calendarSyncType: z.enum(['all', 'with_due_times', 'none']).optional(),
})

// GET /api/user/reminder-settings
export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get or create reminder settings for user
    let reminderSettings = await prisma.reminderSettings.findUnique({
      where: { userId: session.user.id }
    })

    if (!reminderSettings) {
      // Create default settings if none exist
      reminderSettings = await prisma.reminderSettings.create({
        data: {
          userId: session.user.id,
          enablePushReminders: true,
          enableEmailReminders: true,
          defaultReminderTime: 60, // 1 hour before
          enableDailyDigest: true,
          dailyDigestTime: "09:00",
          dailyDigestTimezone: "UTC",
          enableCalendarSync: false,
          calendarSyncType: "all",
        }
      })
    }

    return NextResponse.json(reminderSettings)
  } catch (error) {
    log.error({ err: error }, 'Error fetching reminder settings:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/user/reminder-settings
export async function PUT(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    
    // Validate the request body
    const validatedData = ReminderSettingsSchema.parse(body)

    // Upsert reminder settings
    const reminderSettings = await prisma.reminderSettings.upsert({
      where: { userId: session.user.id },
      update: {
        ...validatedData,
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        ...validatedData,
      }
    })

    return NextResponse.json(reminderSettings)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error updating reminder settings:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}