import { Prisma, PrismaClient } from '@prisma/client'
import type { ReminderSettings, TaskReminderData, DailyDigestData } from '@/types/reminder'
import { createLogger } from '@/lib/logger'
import { digestDay, dueBefore, dueBetween, dueOn, nextDigestAt, WEEKLY_DIGEST_WEEKDAY } from '@/lib/digest-schedule'

/** The columns a digest send reads (AWTD-1454): no full User row. */
interface DigestRow {
  id: string
  dailyDigestTime: string
  dailyDigestTimezone: string
  nextDailyDigestAt: Date | null
  nextWeeklyDigestAt: Date | null
  user: { id: string; email: string; name: string | null }
}

const log = createLogger('reminder-service')


interface EmailService {
  sendTaskReminder: (data: TaskReminderData) => Promise<void>
  sendDailyDigest: (data: DailyDigestData) => Promise<void>
  sendWeeklyDigest: (data: any) => Promise<void>
}

interface PushService {
  sendNotification: (userId: string, payload: any) => Promise<void>
}

export class ReminderService {
  constructor(
    private prisma: PrismaClient,
    private emailService: EmailService,
    private pushService: PushService
  ) {}

  /**
   * How many reminders one invocation will attempt.
   *
   * The query used to be unbounded. After any outage the backlog exceeds the
   * function's time limit, the invocation is killed part-way through, and
   * because delivery was recorded AFTER sending, every reminder already
   * delivered was re-sent on the next minute's run — and the run after that.
   * A bounded batch finishes inside the limit and the next minute continues
   * where this one stopped (task 134bf288).
   */
  private static readonly REMINDER_BATCH_SIZE = 100

  /**
   * How long a claim may sit before another run may take it back.
   *
   * Claiming before sending is what stops duplicates, but a process killed
   * between the claim and the send would strand the reminder forever. This
   * bounds that to one recovery cycle: worst case a single duplicate, rather
   * than an unbounded storm or a silently dropped reminder.
   */
  private static readonly STALE_CLAIM_MS = 10 * 60 * 1000

  /**
   * @returns counts for the cron summary. These used to be `void`, so even a
   * perfect log line could only say "done" — never whether it processed 500
   * reminders or zero (task f74c9370).
   */
  async processDueReminders(): Promise<{ due: number; sent: number; deferred: number; failed: number; staleReleased: number; expired: number }> {
    const now = new Date()

    const staleReleased = await this.releaseStaleClaims(now)
    const expired = await this.expireAbandonedReminders(now)
    let sent = 0
    let deferred = 0
    let failed = 0

    // Get pending reminders that are due, bounded and oldest-first.
    const dueReminders = await this.prisma.reminderQueue.findMany({
      where: {
        status: 'pending',
        type: 'due_reminder',
        scheduledFor: {
          lte: now,
        },
      },
      orderBy: { scheduledFor: 'asc' },
      take: ReminderService.REMINDER_BATCH_SIZE,
      include: {
        task: {
          include: {
            // Only what the send reads: the email names the lists and links the first, and
            // fetches the members itself with a narrow select. This used to load every member's
            // full User row too, and nothing read it (AWTD-1454).
            lists: { select: { id: true, name: true } },
          },
        },
        user: { select: { email: true, name: true } },
      },
    })

    for (const reminder of dueReminders) {
      // Claim it FIRST, conditionally on it still being pending. This is what
      // makes delivery at-most-once per claim: a concurrent invocation, or a
      // re-run after this one is killed, sees a row that is no longer pending
      // and skips it. Previously the row stayed pending until after the email
      // and push had gone out, so a timeout mid-batch re-sent everything
      // already delivered (task 134bf288).
      const claimed = await this.prisma.reminderQueue.updateMany({
        where: { id: reminder.id, status: 'pending' },
        data: { status: 'sending' },
      })
      if (claimed.count === 0) continue

      try {
        const outcome = await this.processSingleReminder(reminder)
        if (outcome === 'sent') sent++
        else deferred++
      } catch (error) {
        failed++
        log.error({ err: error }, `Failed to process reminder ${reminder.id}:`)
        await this.handleReminderFailure(reminder, error)
      }
    }

    return { due: dueReminders.length, sent, deferred, failed, staleReleased, expired }
  }

  /**
   * Return reminders stuck mid-delivery to the queue.
   *
   * A run killed between claiming and sending leaves `sending` behind. Without
   * this they would never be retried; with it, they are retried once the claim
   * is clearly stale rather than immediately, so a slow-but-alive run is not
   * raced by the next minute's invocation.
   */
  /** @returns how many stuck claims were returned to the queue. */
  private async releaseStaleClaims(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ReminderService.STALE_CLAIM_MS)

    const released = await this.prisma.reminderQueue.updateMany({
      where: { status: 'sending', updatedAt: { lt: cutoff } },
      data: { status: 'pending' },
    })

    if (released.count > 0) {
      log.warn(`Released ${released.count} reminder(s) stuck mid-delivery back to pending`)
    }

    return released.count
  }

  /**
   * A reminder due this long ago is dropped rather than delivered. Rows that sat
   * undeliverable for a year (AWTD-1448) must not all fire the moment the cause
   * is fixed.
   */
  private static readonly EXPIRE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

  /** @returns how many reminders were too stale to deliver and were expired. */
  private async expireAbandonedReminders(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ReminderService.EXPIRE_AFTER_MS)
    const result = await this.prisma.reminderQueue.updateMany({
      where: { status: 'pending', type: 'due_reminder', scheduledFor: { lt: cutoff } },
      data: { status: 'expired' },
    })
    if (result.count > 0) {
      log.warn(`Expired ${result.count} reminder(s) overdue by more than 7 days`)
    }
    return result.count
  }

  /**
   * 'sent' means notifications went out. 'deferred' means the claim was
   * released or rescheduled (quiet hours, too far ahead) and nothing was
   * delivered, so the cron stats must not count it as sent.
   */
  private async processSingleReminder(reminder: any): Promise<'sent' | 'deferred'> {
    // No row means the schema defaults (AWTD-1448): push and email on, no quiet
    // hours, UTC. Skipping them left 69 of 133 users with no reminders at all.
    const userSettings =
      (await this.getUserReminderSettings(reminder.userId)) ?? this.defaultReminderSettings(reminder.userId)

    // Check quiet hours
    if (this.isInQuietHours(userSettings)) {
      await this.rescheduleForEndOfQuietHours(reminder, userSettings)
      return 'deferred'
    }

    // Validate reminder timing (don't send reminders too far in advance)
    const task = reminder.task
    if (task.dueDateTime) {
      const timeDiff = new Date(task.dueDateTime).getTime() - new Date().getTime()
      const maxAdvance = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
      
      if (timeDiff > maxAdvance) {
        log.info(`Reminder for task ${task.id} is too far in advance, rescheduling`)
        // Reschedule to 7 days before due date
        const newScheduledFor = new Date(new Date(task.dueDateTime).getTime() - maxAdvance)
        await this.prisma.reminderQueue.update({
          where: { id: reminder.id },
          // Postponed, not delivered — release the claim (task 134bf288).
          data: { scheduledFor: newScheduledFor, status: 'pending' }
        })
        return 'deferred'
      }
    }

    // Send notifications based on user preferences and task settings
    const reminderType = task.reminderType || 'both'
    
    if (userSettings.enablePushReminders && (reminderType === 'push' || reminderType === 'both')) {
      await this.sendPushReminder(reminder, userSettings)
    }

    if (userSettings.enableEmailReminders && (reminderType === 'email' || reminderType === 'both')) {
      await this.sendEmailReminder(reminder)
    }

    // Mark reminder as sent
    await this.prisma.reminderQueue.update({
      where: { id: reminder.id },
      data: {
        status: 'sent',
        data: {
          ...reminder.data,
          sentAt: new Date(),
        },
      },
    })

    // Update task reminder status
    await this.prisma.task.update({
      where: { id: reminder.taskId },
      data: { reminderSent: true },
    })
    return 'sent'
  }

  private async sendPushReminder(reminder: any, userSettings: ReminderSettings): Promise<void> {
    const task = reminder.task
    const dueTime = this.formatTimeForTimezone(task.dueDateTime, userSettings.dailyDigestTimezone)
    
    let title = 'Task Due Soon'
    let body = `${task.title} is due at ${dueTime}`

    // Check if task is overdue
    if (task.dueDateTime && new Date(task.dueDateTime) < new Date()) {
      title = 'Task Overdue'
      body = `${task.title} is overdue`
    }

    await this.pushService.sendNotification(reminder.userId, {
      title,
      body,
      data: {
        taskId: task.id,
        action: 'task_reminder',
        url: `/tasks/${task.id}`,
      },
      actions: [
        {
          action: 'snooze_15',
          title: 'Snooze 15min',
        },
        {
          action: 'snooze_60',
          title: 'Snooze 1hr',
        },
        {
          action: 'complete',
          title: 'Mark Complete',
        },
      ],
    })
  }

  private async sendEmailReminder(reminder: any): Promise<void> {
    const task = reminder.task
    const user = reminder.user

    // Collect unique collaborators from all lists
    const collaboratorsMap = new Map<string, { id: string; name: string; email: string }>()

    // We need to fetch list members separately since Prisma relations are complex
    // Filter out null/undefined list references (deleted lists)
    const lists = (task.lists || []).filter((list: any) => list != null)
    const listIds = lists.map((list: any) => list.id)

    // Get the first list ID for URL generation
    const firstListId = listIds.length > 0 ? listIds[0] : undefined

    // Fetch existing shortcode for this task if available
    let shortcode: string | undefined
    if (task.id) {
      const existingShortcode = await this.prisma.shortcode.findFirst({
        where: {
          targetId: task.id,
          targetType: 'task',
          isActive: true,
        },
        select: {
          code: true,
        },
      })
      shortcode = existingShortcode?.code
    }

    if (listIds.length > 0) {
      const listMembers = await this.prisma.listMember.findMany({
        where: {
          listId: { in: listIds },
          userId: { not: reminder.userId } // Exclude the assignee (the query loads no user.id, AWTD-1475)
        },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        }
      })

      listMembers.forEach(member => {
        collaboratorsMap.set(member.user.id, {
          id: member.user.id,
          name: member.user.name || member.user.email,
          email: member.user.email
        })
      })
    }

    const reminderData: TaskReminderData = {
      taskId: task.id,
      title: task.title,
      dueDateTime: task.dueDateTime,
      assigneeEmail: user.email,
      assigneeName: user.name,
      listNames: lists.map((list: any) => list.name),
      listId: firstListId,
      shortcode,
      collaborators: Array.from(collaboratorsMap.values()),
    }

    await this.emailService.sendTaskReminder(reminderData)
  }

  private isInQuietHours(settings: ReminderSettings): boolean {
    if (!settings.quietHoursStart || !settings.quietHoursEnd) {
      return false
    }

    const now = new Date()
    const userTimezone = settings.dailyDigestTimezone
    
    // Convert current time to user's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    })
    
    const userTimeString = formatter.format(now)
    const [currentHour, currentMinute] = userTimeString.split(':').map(Number)
    const currentTimeInMinutes = currentHour * 60 + currentMinute

    const [startHour, startMinute] = settings.quietHoursStart.split(':').map(Number)
    const [endHour, endMinute] = settings.quietHoursEnd.split(':').map(Number)
    
    const startTimeInMinutes = startHour * 60 + startMinute
    const endTimeInMinutes = endHour * 60 + endMinute

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTimeInMinutes > endTimeInMinutes) {
      return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes
    } else {
      return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes
    }
  }

  private async rescheduleForEndOfQuietHours(reminder: any, settings: ReminderSettings): Promise<void> {
    if (!settings.quietHoursEnd) return

    const [endHour, endMinute] = settings.quietHoursEnd.split(':').map(Number)
    const userTimezone = settings.dailyDigestTimezone
    
    const now = new Date()
    
    // Create end of quiet hours time
    const endOfQuietHours = new Date(now)
    
    if (userTimezone === 'UTC') {
      // For UTC, set the time directly
      endOfQuietHours.setUTCHours(endHour, endMinute, 0, 0)
      
      // If we're already past the end time today, schedule for tomorrow
      if (now.getUTCHours() >= endHour && (now.getUTCHours() > endHour || now.getUTCMinutes() >= endMinute)) {
        endOfQuietHours.setUTCDate(endOfQuietHours.getUTCDate() + 1)
      }
    } else {
      // For non-UTC timezones, create time string and convert
      const today = now.toLocaleDateString('en-CA', { timeZone: userTimezone })
      const endTimeString = `${today}T${settings.quietHoursEnd}:00`
      const endOfQuietHoursLocal = new Date(endTimeString)
      
      // Convert to UTC
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        hour12: false,
        hour: '2-digit', 
        minute: '2-digit'
      })
      
      const currentUserTime = formatter.format(now)
      const [currentHour, currentMinute] = currentUserTime.split(':').map(Number)
      const currentTimeInMinutes = currentHour * 60 + currentMinute
      const endTimeInMinutes = endHour * 60 + endMinute
      
      // Calculate end of quiet hours in UTC
      endOfQuietHours.setTime(endOfQuietHoursLocal.getTime())
      
      // If we're past the end time today in user timezone, schedule for tomorrow
      if (currentTimeInMinutes >= endTimeInMinutes) {
        endOfQuietHours.setDate(endOfQuietHours.getDate() + 1)
      }
    }

    log.info(`Rescheduled reminder ${reminder.id} to end of quiet hours: ${endOfQuietHours}`)

    await this.prisma.reminderQueue.update({
      where: { id: reminder.id },
      data: {
        scheduledFor: endOfQuietHours,
        retryCount: (reminder.retryCount || 0) + 1,
        // Release the claim taken in processDueReminders: this reminder was not
        // delivered, it was postponed, so it must be pending again for the run
        // that covers its new time (task 134bf288).
        status: 'pending',
      },
    })
  }

  private getTimezoneOffset(timezone: string): number {
    const now = new Date()
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000)
    const targetTime = new Date(utcTime + (this.getTimezoneOffsetInMinutes(timezone) * 60000))
    return targetTime.getTimezoneOffset() * -1
  }
  
  private getTimezoneOffsetInMinutes(timezone: string): number {
    const now = new Date()
    const utc = new Date(now.getTime() + (now.getTimezoneOffset() * 60000))
    const target = new Date(utc.toLocaleString('en-US', { timeZone: timezone }))
    return (utc.getTime() - target.getTime()) / 60000
  }

  private formatTimeForTimezone(date: Date, timezone: string): string {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(date))
    } catch (error) {
      // Fallback to UTC if timezone is invalid
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(date))
    }
  }

  /** Rows each digest pass schedules, and sends, per run (AWTD-1454). */
  private static readonly DIGEST_BATCH_SIZE = 200
  /**
   * A digest slot missed by more than this (the cron was down) is moved on without sending: an
   * 08:30 digest arriving in the afternoon is noise, and the next one is due tomorrow anyway.
   */
  private static readonly DIGEST_LATE_LIMIT_MS = 60 * 60 * 1000

  /**
   * Daily digests that are due. Runs every minute (the reminders cron) and reads only the rows
   * whose `nextDailyDigestAt` has come, by index, rather than every user (AWTD-1454); each goes
   * out at the user's own `dailyDigestTime` (AWTD-1453).
   */
  async processDailyDigests(): Promise<void> {
    await this.processDigests('nextDailyDigestAt', undefined, (row, now) => this.sendDailyDigestForUser(row, now))
  }

  /** Weekly digests: Mondays on the user's clock, at their digest time. */
  async processWeeklyDigests(): Promise<void> {
    await this.processDigests('nextWeeklyDigestAt', WEEKLY_DIGEST_WEEKDAY, (row, now) =>
      this.sendWeeklyDigestForUser(row, now)
    )
  }

  private async processDigests(
    field: 'nextDailyDigestAt' | 'nextWeeklyDigestAt',
    weekday: number | undefined,
    send: (row: DigestRow, now: Date) => Promise<void>
  ): Promise<void> {
    const now = new Date()
    const nextSlot = (row: { dailyDigestTime: string; dailyDigestTimezone: string }) =>
      nextDigestAt(row.dailyDigestTime, row.dailyDigestTimezone, now, weekday)

    // Schedule the rows that have no slot yet: every row once after the column was added, and any
    // whose digest settings changed since (digestScheduleReset clears the slot). Conditional on
    // still being null, so a concurrent run cannot move a slot this one just set.
    const unscheduled = await this.prisma.reminderSettings.findMany({
      where: { enableDailyDigest: true, [field]: null } as Prisma.ReminderSettingsWhereInput,
      select: { id: true, dailyDigestTime: true, dailyDigestTimezone: true },
      take: ReminderService.DIGEST_BATCH_SIZE,
    })
    for (const row of unscheduled) {
      await this.prisma.reminderSettings.updateMany({
        where: { id: row.id, [field]: null } as Prisma.ReminderSettingsWhereInput,
        data: { [field]: nextSlot(row) },
      })
    }

    const due = await this.prisma.reminderSettings.findMany({
      where: { enableDailyDigest: true, [field]: { lte: now } } as Prisma.ReminderSettingsWhereInput,
      orderBy: { [field]: 'asc' },
      take: ReminderService.DIGEST_BATCH_SIZE,
      select: {
        id: true,
        dailyDigestTime: true,
        dailyDigestTimezone: true,
        nextDailyDigestAt: true,
        nextWeeklyDigestAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    })

    for (const row of due) {
      const slot = row[field]
      if (!slot) continue
      // Claim FIRST, by moving the slot on, conditionally on it being unchanged: a concurrent or
      // re-run tick sees a different slot and skips it, so one slot is one send (as
      // processDueReminders claims before sending, task 134bf288).
      const claimed = await this.prisma.reminderSettings.updateMany({
        where: { id: row.id, [field]: slot } as Prisma.ReminderSettingsWhereInput,
        data: { [field]: nextSlot(row) },
      })
      if (claimed.count === 0) continue
      if (now.getTime() - slot.getTime() > ReminderService.DIGEST_LATE_LIMIT_MS) continue

      try {
        await send(row, now)
      } catch (error) {
        log.error({ err: error }, `Failed to send ${field === 'nextDailyDigestAt' ? 'daily' : 'weekly'} digest for user ${row.user.id}:`)
      }
    }
  }

  private async sendDailyDigestForUser(row: DigestRow, now: Date): Promise<void> {
    const { user, dailyDigestTimezone: zone } = row

    // Today and tomorrow are the user's calendar days, not the server's (AWTD-1453).
    const today = digestDay(now, zone, 0)
    const tomorrow = digestDay(now, zone, 1)
    const openTasksFor = { assigneeId: user.id, completed: false }

    const [dueTodayTasks, dueTomorrowTasks, overdueTasks] = await Promise.all([
      // Due today
      this.prisma.task.findMany({
        where: { ...openTasksFor, ...dueOn(today) },
        include: {
          lists: { select: { name: true } },
        },
      }),
      // Due tomorrow
      this.prisma.task.findMany({
        where: { ...openTasksFor, ...dueOn(tomorrow) },
        include: {
          lists: { select: { name: true } },
        },
      }),
      // Overdue
      this.prisma.task.findMany({
        where: { ...openTasksFor, ...dueBefore(today) },
        include: {
          lists: { select: { name: true } },
        },
      }),
    ])

    // Only send digest if there are tasks to report
    if (dueTodayTasks.length === 0 && dueTomorrowTasks.length === 0 && overdueTasks.length === 0) {
      return
    }

    const digestData: DailyDigestData = {
      userId: user.id,
      userEmail: user.email,
      userName: user.name ?? '',
      dueTodayTasks: dueTodayTasks.map(this.taskToReminderData),
      dueTomorrowTasks: dueTomorrowTasks.map(this.taskToReminderData),
      overdueTasks: overdueTasks.map(this.taskToReminderData),
      upcomingTasks: [], // Tasks due later than tomorrow - not included in daily digest
    }

    await this.emailService.sendDailyDigest(digestData)
  }

  private async sendWeeklyDigestForUser(row: DigestRow, now: Date): Promise<void> {
    const { user, dailyDigestTimezone: zone } = row

    // From now to the end of the user's Sunday (the start of next Monday).
    const today = digestDay(now, zone, 0)
    const endOfWeek = digestDay(now, zone, 7)

    const upcomingTasks = await this.prisma.task.findMany({
      where: {
        assigneeId: user.id,
        completed: false,
        ...dueBetween(today, endOfWeek, now),
      },
      include: {
        lists: { select: { name: true } },
      },
      orderBy: {
        dueDateTime: 'asc',
      },
    })

    if (upcomingTasks.length === 0) {
      return
    }

    await this.emailService.sendWeeklyDigest({
      userId: user.id,
      userEmail: user.email,
      userName: user.name ?? '',
      upcomingTasks: upcomingTasks.map(this.taskToReminderData),
    })
  }

  private taskToReminderData = (task: any): TaskReminderData => ({
    taskId: task.id,
    title: task.title,
    dueDateTime: task.dueDateTime,
    assigneeEmail: task.assignee?.email,
    assigneeName: task.assignee?.name,
    listNames: (task.lists || []).filter((list: any) => list != null).map((list: any) => list.name),
  })

  async snoozeReminder(reminderId: string, minutes: number): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate snooze duration
      if (minutes <= 0 || minutes > 10080) { // Max 1 week
        return { success: false, error: 'Invalid snooze duration. Must be between 1 minute and 1 week.' }
      }

      const reminder = await this.prisma.reminderQueue.findUnique({
        where: { id: reminderId },
      })

      if (!reminder) {
        return { success: false, error: 'Reminder not found' }
      }

      // Check snooze limit
      const reminderData = reminder.data as any || {}
      const currentSnoozeCount = reminderData.snoozeCount || 0
      if (currentSnoozeCount >= 5) {
        return { success: false, error: 'maximum snooze limit reached (5 times)' }
      }

      // Calculate new scheduled time
      const newScheduledFor = new Date(Date.now() + minutes * 60 * 1000)

      await this.prisma.reminderQueue.update({
        where: { id: reminderId },
        data: {
          scheduledFor: newScheduledFor,
          retryCount: (reminder.retryCount || 0) + 1,
          data: {
            ...reminderData,
            snoozedAt: new Date(),
            snoozeCount: currentSnoozeCount + 1,
            originalScheduledFor: reminderData.originalScheduledFor || reminder.scheduledFor,
          },
        },
      })

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'Error snoozing reminder:')
      return { success: false, error: 'Failed to snooze reminder' }
    }
  }

  async dismissReminder(reminderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.prisma.reminderQueue.delete({
        where: { id: reminderId },
      })

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'Error dismissing reminder:')
      return { success: false, error: 'Failed to dismiss reminder' }
    }
  }

  /** @returns how many failed reminders were rescheduled, and how many could not be. */
  async retryFailedReminders(): Promise<{ eligible: number; rescheduled: number; failed: number }> {
    const failedReminders = await this.prisma.reminderQueue.findMany({
      where: {
        status: 'failed',
        retryCount: { lt: 3 }, // Max 3 retries
      },
    })

    let rescheduled = 0
    let failed = 0

    for (const reminder of failedReminders) {
      try {
        // Exponential backoff: 2^retryCount minutes
        const backoffMinutes = Math.pow(2, reminder.retryCount)
        const newScheduledFor = new Date(Date.now() + backoffMinutes * 60 * 1000)

        await this.prisma.reminderQueue.update({
          where: { id: reminder.id },
          data: {
            scheduledFor: newScheduledFor,
            status: 'pending',
          },
        })

        rescheduled++
        log.info(`Rescheduled failed reminder ${reminder.id} with ${backoffMinutes}min backoff`)
      } catch (error) {
        failed++
        log.error({ err: error }, `Failed to reschedule reminder ${reminder.id}:`)
      }
    }

    return { eligible: failedReminders.length, rescheduled, failed }
  }

  private async handleReminderFailure(reminder: any, error: any): Promise<void> {
    await this.prisma.reminderQueue.update({
      where: { id: reminder.id },
      data: {
        status: 'failed',
        retryCount: (reminder.retryCount || 0) + 1,
        data: {
          ...reminder.data,
          lastError: error.message,
          lastAttempt: new Date(),
        },
      },
    })
  }

  /** Mirrors the `ReminderSettings` column defaults in schema.prisma. */
  private defaultReminderSettings(userId: string): ReminderSettings {
    const now = new Date()
    return {
      id: `default-${userId}`,
      userId,
      enablePushReminders: true,
      enableEmailReminders: true,
      defaultReminderTime: 60,
      enableDailyDigest: true,
      dailyDigestTime: '09:00',
      dailyDigestTimezone: 'UTC',
      quietHoursStart: null,
      quietHoursEnd: null,
      createdAt: now,
      updatedAt: now,
      calendarSyncType: 'all',
      enableCalendarSync: false,
    }
  }

  private async getUserReminderSettings(userId: string): Promise<ReminderSettings | null> {
    return await this.prisma.reminderSettings.findUnique({
      where: { userId },
    })
  }
}