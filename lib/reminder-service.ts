import { PrismaClient } from '@prisma/client'
import type { ReminderSettings, TaskReminderData, DailyDigestData } from '@/types/reminder'
import { createLogger } from '@/lib/logger'

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

  async processDueReminders(): Promise<void> {
    const now = new Date()

    await this.releaseStaleClaims(now)

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
            lists: {
              include: {
                listMembers: {
                  include: {
                    user: true
                  }
                }
              }
            },
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
        await this.processSingleReminder(reminder)
      } catch (error) {
        log.error({ err: error }, `Failed to process reminder ${reminder.id}:`)
        await this.handleReminderFailure(reminder, error)
      }
    }
  }

  /**
   * Return reminders stuck mid-delivery to the queue.
   *
   * A run killed between claiming and sending leaves `sending` behind. Without
   * this they would never be retried; with it, they are retried once the claim
   * is clearly stale rather than immediately, so a slow-but-alive run is not
   * raced by the next minute's invocation.
   */
  private async releaseStaleClaims(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - ReminderService.STALE_CLAIM_MS)

    const released = await this.prisma.reminderQueue.updateMany({
      where: { status: 'sending', updatedAt: { lt: cutoff } },
      data: { status: 'pending' },
    })

    if (released.count > 0) {
      log.warn(`Released ${released.count} reminder(s) stuck mid-delivery back to pending`)
    }
  }

  private async processSingleReminder(reminder: any): Promise<void> {
    const userSettings = await this.getUserReminderSettings(reminder.userId)

    if (!userSettings) {
      // Nothing to send and nothing to wait for. Releasing the claim rather
      // than returning silently keeps this out of the stale-claim sweep every
      // ten minutes forever (task 134bf288).
      await this.prisma.reminderQueue.update({
        where: { id: reminder.id },
        data: { status: 'pending' },
      })
      return
    }

    // Check quiet hours
    if (this.isInQuietHours(userSettings)) {
      await this.rescheduleForEndOfQuietHours(reminder, userSettings)
      return
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
        return
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
          userId: { not: user.id } // Exclude the assignee
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

  async processDailyDigests(): Promise<void> {
    const users = await this.prisma.user.findMany({
      include: {
        reminderSettings: true,
      },
    })

    for (const user of users) {
      if (!user.reminderSettings?.enableDailyDigest) {
        continue
      }

      try {
        await this.sendDailyDigestForUser(user)
      } catch (error) {
        log.error({ err: error }, `Failed to send daily digest for user ${user.id}:`)
      }
    }
  }

  private async sendDailyDigestForUser(user: any): Promise<void> {
    const settings = user.reminderSettings
    const now = new Date()
    
    // Check if it's the right time for this user's daily digest
    if (!this.isTimeForDailyDigest(settings, now)) {
      return
    }

    // Get tasks for the digest
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const startOfTomorrow = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate())
    const endOfTomorrow = new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000)

    const [dueTodayTasks, dueTomorrowTasks, overdueTasks] = await Promise.all([
      // Due today
      this.prisma.task.findMany({
        where: {
          assigneeId: user.id,
          completed: false,
          dueDateTime: {
            gte: startOfToday,
            lt: startOfTomorrow,
          },
        },
        include: {
          lists: { select: { name: true } },
        },
      }),
      // Due tomorrow
      this.prisma.task.findMany({
        where: {
          assigneeId: user.id,
          completed: false,
          dueDateTime: {
            gte: startOfTomorrow,
            lt: endOfTomorrow,
          },
        },
        include: {
          lists: { select: { name: true } },
        },
      }),
      // Overdue
      this.prisma.task.findMany({
        where: {
          assigneeId: user.id,
          completed: false,
          dueDateTime: {
            lt: startOfToday,
          },
        },
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
      userName: user.name,
      dueTodayTasks: dueTodayTasks.map(this.taskToReminderData),
      dueTomorrowTasks: dueTomorrowTasks.map(this.taskToReminderData),
      overdueTasks: overdueTasks.map(this.taskToReminderData),
      upcomingTasks: [], // Tasks due later than tomorrow - not included in daily digest
    }

    await this.emailService.sendDailyDigest(digestData)
  }

  private isTimeForDailyDigest(settings: ReminderSettings, now: Date): boolean {
    const [targetHour, targetMinute] = settings.dailyDigestTime.split(':').map(Number)
    const timezone = settings.dailyDigestTimezone
    
    try {
      // Get current time in user's timezone
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
      const currentHour = userTime.getHours()
      const currentMinute = userTime.getMinutes()
      
      // Allow 5-minute window for digest delivery
      const currentTimeInMinutes = currentHour * 60 + currentMinute
      const targetTimeInMinutes = targetHour * 60 + targetMinute
      
      return Math.abs(currentTimeInMinutes - targetTimeInMinutes) <= 5
    } catch (error) {
      log.error({ err: error }, 'Error checking digest time:')
      return false
    }
  }

  async processWeeklyDigests(): Promise<void> {
    const users = await this.prisma.user.findMany({
      include: {
        reminderSettings: true,
      },
    })

    // Process weekly digests on Mondays
    const now = new Date()
    if (now.getDay() !== 1) { // 1 = Monday
      return
    }

    for (const user of users) {
      if (!user.reminderSettings?.enableDailyDigest) {
        continue // Use same setting for weekly digest
      }

      try {
        await this.sendWeeklyDigestForUser(user)
      } catch (error) {
        log.error({ err: error }, `Failed to send weekly digest for user ${user.id}:`)
      }
    }
  }

  private async sendWeeklyDigestForUser(user: any): Promise<void> {
    const settings = user.reminderSettings
    
    // Check if it's the right time (same as daily digest time)
    if (!this.isTimeForDailyDigest(settings, new Date())) {
      return
    }

    // Get tasks due this week
    const now = new Date()
    const endOfWeek = new Date(now)
    endOfWeek.setDate(now.getDate() + (7 - now.getDay())) // End of current week (Saturday)
    endOfWeek.setHours(23, 59, 59, 999)

    const upcomingTasks = await this.prisma.task.findMany({
      where: {
        assigneeId: user.id,
        completed: false,
        dueDateTime: {
          gte: now,
          lte: endOfWeek,
        },
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
      userName: user.name,
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

  async retryFailedReminders(): Promise<void> {
    const failedReminders = await this.prisma.reminderQueue.findMany({
      where: {
        status: 'failed',
        retryCount: { lt: 3 }, // Max 3 retries
      },
    })

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

        log.info(`Rescheduled failed reminder ${reminder.id} with ${backoffMinutes}min backoff`)
      } catch (error) {
        log.error({ err: error }, `Failed to reschedule reminder ${reminder.id}:`)
      }
    }
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

  private async getUserReminderSettings(userId: string): Promise<ReminderSettings | null> {
    return await this.prisma.reminderSettings.findUnique({
      where: { userId },
    })
  }
}