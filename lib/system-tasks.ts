import { BRAND } from '@/lib/brand/config'
import { prisma } from "./prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('system-tasks')


/**
 * System Tasks Service
 *
 * Creates and manages system-assigned tasks for users.
 * These are tasks automatically created by the system for onboarding,
 * reminders, or other automated workflows.
 */

// System task identifiers - use these to find/complete system tasks
export const SYSTEM_TASK_TITLES = {
  VERIFY_EMAIL: `Verify your email address with ${BRAND.domain}`,
} as const

export type SystemTaskType = keyof typeof SYSTEM_TASK_TITLES

/**
 * Create the "Verify Email" system task for a user
 */
export async function createVerifyEmailTask(userId: string): Promise<{ created: boolean; taskId?: string }> {
  try {
    // Check if user already has this task (incomplete)
    const existingTask = await prisma.task.findFirst({
      where: {
        assigneeId: userId,
        title: SYSTEM_TASK_TITLES.VERIFY_EMAIL,
        completed: false,
      },
    })

    if (existingTask) {
      log.info(`[SystemTasks] User ${userId} already has verify email task`)
      return { created: false, taskId: existingTask.id }
    }

    // Check if user is already verified (no need to create task)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailVerified: true,
        accounts: { select: { provider: true } }
      },
    })

    if (!user) {
      log.info(`[SystemTasks] User ${userId} not found`)
      return { created: false }
    }

    const hasOAuth = user.accounts && user.accounts.length > 0
    const isVerified = hasOAuth || !!user.emailVerified

    if (isVerified) {
      log.info(`[SystemTasks] User ${userId} is already verified, skipping task creation`)
      return { created: false }
    }

    // Create the task with due date of today
    const today = new Date()
    today.setHours(17, 0, 0, 0) // Due at 5 PM today

    const task = await prisma.task.create({
      data: {
        title: SYSTEM_TASK_TITLES.VERIFY_EMAIL,
        description: `**Why:** Verified emails help us protect your account and enable collaboration.

1. Check your inbox for an email from ${BRAND.appName}
2. If you don't see it in your inbox, check your spam/junk folder
3. If it still isn't there, go to ${BRAND.appName}.cc or the iOS app and go to Settings > Account & Access and resend the verification email`,
        assigneeId: userId,
        creatorId: null, // System-created task
        dueDateTime: today,
        isAllDay: true,
        priority: 3, // Highest priority
        isPrivate: true,
      },
    })

    log.info(`[SystemTasks] Created verify email task ${task.id} for user ${userId}`)
    return { created: true, taskId: task.id }
  } catch (error) {
    log.error({ err: error }, `[SystemTasks] Error creating verify email task for user ${userId}:`)
    return { created: false }
  }
}

/**
 * Complete the "Verify Email" system task for a user
 */
export async function completeVerifyEmailTask(userId: string): Promise<{ completed: boolean }> {
  try {
    // Find the incomplete verify email task
    const task = await prisma.task.findFirst({
      where: {
        assigneeId: userId,
        title: SYSTEM_TASK_TITLES.VERIFY_EMAIL,
        completed: false,
      },
    })

    if (!task) {
      log.info(`[SystemTasks] No incomplete verify email task found for user ${userId}`)
      return { completed: false }
    }

    // Mark it as complete
    await prisma.task.update({
      where: { id: task.id },
      data: { completed: true },
    })

    log.info(`[SystemTasks] Completed verify email task ${task.id} for user ${userId}`)
    return { completed: true }
  } catch (error) {
    log.error({ err: error }, `[SystemTasks] Error completing verify email task for user ${userId}:`)
    return { completed: false }
  }
}

/**
 * Create verify email tasks for all unverified users who don't have one
 * Used by the weekly cron job
 */
export async function createVerifyEmailTasksForUnverifiedUsers(): Promise<{
  processed: number
  created: number
  skipped: number
  errors: number
}> {
  const stats = { processed: 0, created: 0, skipped: 0, errors: 0 }

  try {
    // Find all users without OAuth accounts and without emailVerified
    const unverifiedUsers = await prisma.user.findMany({
      where: {
        emailVerified: null,
        accounts: {
          none: {}, // No OAuth accounts
        },
      },
      select: { id: true, email: true },
    })

    log.info(`[SystemTasks] Found ${unverifiedUsers.length} unverified users`)

    for (const user of unverifiedUsers) {
      stats.processed++
      try {
        const result = await createVerifyEmailTask(user.id)
        if (result.created) {
          stats.created++
        } else {
          stats.skipped++
        }
      } catch (error) {
        log.error({ err: error }, `[SystemTasks] Error processing user ${user.id}:`)
        stats.errors++
      }
    }

    log.info({ stats }, `[SystemTasks] Batch complete:`)
    return stats
  } catch (error) {
    log.error({ err: error }, `[SystemTasks] Error in batch processing:`)
    throw error
  }
}
