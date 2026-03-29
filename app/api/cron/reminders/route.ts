import { NextRequest, NextResponse } from 'next/server'
import { ReminderService } from '@/lib/reminder-service'
import { EmailReminderService } from '@/lib/email-reminder-service'
import { PushNotificationService } from '@/lib/push-notification-service'
import { processAgentTasksDueSoon } from '@/lib/agent-task-scheduler'
import { prisma } from '@/lib/prisma'

// Initialize services
const emailService = new EmailReminderService()
const pushService = new PushNotificationService()
const reminderService = new ReminderService(prisma, emailService, pushService)

// Vercel Cron job endpoint - runs every minute
export async function GET(request: NextRequest) {
  try {
    console.log('🔄 Processing reminders...')

    // Verify the request is from Vercel cron
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const startTime = Date.now()

    // Process different types of reminders + agent task dispatch
    await Promise.allSettled([
      reminderService.processDueReminders(),
      reminderService.retryFailedReminders(),
      processAgentTasksDueSoon(),
    ])

    // Check if it's time for daily digests (runs every hour, but service filters by time)
    const now = new Date()
    if (now.getMinutes() === 0) { // Top of every hour
      await Promise.allSettled([
        reminderService.processDailyDigests(),
        reminderService.processWeeklyDigests(),
      ])
    }

    const duration = Date.now() - startTime
    console.log(`✅ Reminder processing completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ Error in reminder cron job:', error)
    return NextResponse.json(
      { error: 'Reminder processing failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

// Allow manual triggering via POST for development/testing
export async function POST(request: NextRequest) {
  try {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 })
    }

    const { type } = await request.json().catch(() => ({ type: 'all' }))

    console.log(`🔄 Manually processing reminders (type: ${type})...`)

    const startTime = Date.now()

    switch (type) {
      case 'due':
        await reminderService.processDueReminders()
        break
      case 'daily':
        await reminderService.processDailyDigests()
        break
      case 'weekly':
        await reminderService.processWeeklyDigests()
        break
      case 'retry':
        await reminderService.retryFailedReminders()
        break
      default:
        await Promise.allSettled([
          reminderService.processDueReminders(),
          reminderService.processDailyDigests(),
          reminderService.processWeeklyDigests(),
          reminderService.retryFailedReminders(),
        ])
    }

    const duration = Date.now() - startTime

    return NextResponse.json({
      success: true,
      type,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ Error in manual reminder processing:', error)
    return NextResponse.json(
      { error: 'Manual reminder processing failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}