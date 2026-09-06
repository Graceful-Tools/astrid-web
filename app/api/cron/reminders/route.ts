import { NextRequest, NextResponse } from 'next/server'
import { ReminderService } from '@/lib/reminder-service'
import { EmailReminderService } from '@/lib/email-reminder-service'
import { PushNotificationService } from '@/lib/push-notification-service'
import { processAgentTasksDueSoon } from '@/lib/agent-task-scheduler'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'

const log = createLogger('cron.reminders')


// Initialize services
const emailService = new EmailReminderService()
const pushService = new PushNotificationService()
const reminderService = new ReminderService(prisma, emailService, pushService)

// Vercel Cron job endpoint - runs every minute
export async function GET(request: NextRequest) {
  // Authorised FIRST, and before any logging. The old order logged
  // "Processing reminders..." and only then checked the secret, so a rejected
  // run and a successful one produced an identical first line and nothing
  // else — which is exactly what made this job unobservable (task f74c9370).
  // Fails CLOSED: no CRON_SECRET configured means nobody gets in, and
  // requireCronSecret now says so at warn level.
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('reminders', async () => {
    // allSettled by design: one failing sub-job must not stop the others. But
    // it also swallows the rejection, so the outcomes are counted rather than
    // discarded.
    const [due, retry, agents] = await Promise.allSettled([
      reminderService.processDueReminders(),
      reminderService.retryFailedReminders(),
      processAgentTasksDueSoon(),
    ])

    // Digests run at the top of every hour; the services filter by user time.
    const now = new Date()
    let digestsAttempted = false
    if (now.getMinutes() === 0) {
      digestsAttempted = true
      await Promise.allSettled([
        reminderService.processDailyDigests(),
        reminderService.processWeeklyDigests(),
      ])
    }

    return {
      remindersDue: due.status === 'fulfilled' ? due.value.due : -1,
      remindersSent: due.status === 'fulfilled' ? due.value.sent : -1,
      remindersFailed: due.status === 'fulfilled' ? due.value.failed : -1,
      staleClaimsReleased: due.status === 'fulfilled' ? due.value.staleReleased : -1,
      retriesRescheduled: retry.status === 'fulfilled' ? retry.value.rescheduled : -1,
      agentTasksDispatched: agents.status === 'fulfilled' ? agents.value : -1,
      // -1 means the sub-job threw. A count of 0 and "we never found out" are
      // different answers and the summary has to be able to tell them apart.
      subJobsFailed: [due, retry, agents].filter((r) => r.status === 'rejected').length,
      digestsAttempted,
    }
  })
}

// Allow manual triggering via POST for development/testing
export async function POST(request: NextRequest) {
  try {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 })
    }

    const { type } = await request.json().catch(() => ({ type: 'all' }))

    log.info(`🔄 Manually processing reminders (type: ${type})...`)

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
    log.error({ err: error }, '❌ Error in manual reminder processing:')
    return NextResponse.json(
      { error: 'Manual reminder processing failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}