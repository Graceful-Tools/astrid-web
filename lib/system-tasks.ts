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
 * Users per page in the weekly sweep (task f9ba26b3). One `createMany` per page.
 */
export const VERIFY_EMAIL_BATCH_SIZE = 100

/**
 * Ceiling for one run. The cron route shares a 60-second budget, and a run that
 * is killed mid-page is indistinguishable from one that finished — so it stops
 * deliberately and reports `capped` instead. Progress is real either way: the
 * users it handled no longer match the query, so next week starts past them.
 */
export const MAX_VERIFY_EMAIL_USERS_PER_RUN = 1000

/**
 * The single source of truth for what a verify-email task IS.
 *
 * The batch path used to call `createVerifyEmailTask` per user, so the two
 * could not diverge. Now that the batch writes with `createMany`, this is what
 * keeps them identical — otherwise a user swept up by the cron would quietly
 * get a different task from one created at signup.
 */
export function buildVerifyEmailTaskData(userId: string) {
  // Due at 5 PM today.
  const today = new Date()
  today.setHours(17, 0, 0, 0)

  return {
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
  }
}

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

    const task = await prisma.task.create({ data: buildVerifyEmailTaskData(userId) })

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
 * Create verify email tasks for all unverified users who don't have one.
 * Used by the weekly cron job.
 *
 * PAGING WITHOUT A CURSOR (task f9ba26b3)
 * ---------------------------------------
 * This used to load every unverified user with no `take`, then spend two or
 * three queries per user discovering that most already had the task. The work
 * never shrank the set being scanned, so a run killed by the 60-second budget
 * re-processed the identical prefix the next week and the tail was never
 * reached — permanently, not eventually.
 *
 * Adding a `take` alone would have preserved that exactly. Instead the QUERY
 * now asks for users who genuinely need the task, which means creating it
 * REMOVES the user from the result set. Repeatedly taking the first page is
 * therefore real progress, and needs no resume cursor and no new column.
 *
 * The flip side of a self-consuming page is that it can only be re-read if the
 * write did nothing, so both no-op and failure break the loop rather than
 * asking for the same page again.
 */
export async function createVerifyEmailTasksForUnverifiedUsers(): Promise<{
  processed: number
  created: number
  skipped: number
  errors: number
  /** True when the per-run ceiling stopped a run with users still waiting. */
  capped: boolean
}> {
  const stats = { processed: 0, created: 0, skipped: 0, errors: 0, capped: false }

  while (stats.processed < MAX_VERIFY_EMAIL_USERS_PER_RUN) {
    const remaining = MAX_VERIFY_EMAIL_USERS_PER_RUN - stats.processed

    const batch = await prisma.user.findMany({
      where: {
        emailVerified: null,
        accounts: { none: {} }, // No OAuth accounts
        // The whole fix. Without this the page is the same one every week.
        assignedTasks: {
          none: { title: SYSTEM_TASK_TITLES.VERIFY_EMAIL, completed: false },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.min(VERIFY_EMAIL_BATCH_SIZE, remaining),
    })

    if (batch.length === 0) return finish(stats)

    try {
      const written = await prisma.task.createMany({
        data: batch.map(user => buildVerifyEmailTaskData(user.id)),
      })

      stats.processed += batch.length
      stats.created += written.count
      stats.skipped += batch.length - written.count

      // Nobody left the set, so the next query returns this same page. Stop
      // rather than loop on it.
      if (written.count === 0) return finish(stats)
    } catch (error) {
      // One page's failure ends the run instead of retrying the identical page
      // until the function is killed. The users are untouched and still match
      // the query, so next week picks them up first.
      log.error({ err: error }, `[SystemTasks] Batch write failed; ending run:`)
      stats.errors += batch.length
      return finish(stats)
    }
  }

  stats.capped = true
  return finish(stats)
}

function finish<T extends { processed: number; created: number }>(stats: T): T {
  log.info({ stats }, `[SystemTasks] Batch complete:`)
  return stats
}
