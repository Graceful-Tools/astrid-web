import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ReminderService } from '@/lib/reminder-service'
import type { ReminderSettings, Task, User } from '@/types'

// Mock Prisma
const mockPrisma = {
  task: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  reminderQueue: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    // processDueReminders claims each reminder before sending it, so a
    // delivery already made is not re-sent when a run is killed part-way
    // through a backlog (task 134bf288). The default here is "the claim
    // succeeded", which is the path these tests exercise.
    updateMany: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn(),
  },
  reminderSettings: {
    findUnique: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  listMember: {
    findMany: vi.fn(),
  },
  taskList: {
    findMany: vi.fn(),
  },
  shortcode: {
    findFirst: vi.fn(),
  },
} as unknown as PrismaClient

// Mock email service
const mockEmailService = {
  sendTaskReminder: vi.fn(),
  sendDailyDigest: vi.fn(),
  sendWeeklyDigest: vi.fn(),
}

// Mock push notification service
const mockPushService = {
  sendNotification: vi.fn(),
}

describe('ReminderService', () => {
  let reminderService: ReminderService
  let mockDate: Date

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: the claim in processDueReminders succeeds, and the stale-claim
    // sweep releases nothing (task 134bf288).
    mockPrisma.reminderQueue.updateMany.mockResolvedValue({ count: 1 })
    // Mock current time to a fixed date for predictable testing
    mockDate = new Date('2024-01-15T10:00:00Z') // Monday 10:00 AM UTC
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
    
    reminderService = new ReminderService(mockPrisma, mockEmailService, mockPushService)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Due Reminders', () => {
    it('should send reminder at correct time based on user timezone', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60, // 1 hour before
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'America/New_York', // EST/EDT
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const task = {
        id: 'task1',
        title: 'Important Task',
        dueDateTime: new Date('2024-01-15T16:00:00Z'), // 4 PM UTC = 11 AM EST
        reminderTime: new Date('2024-01-15T15:00:00Z'), // 3 PM UTC = 10 AM EST (1 hour before)
        reminderType: 'both' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ id: 'list1', name: 'Work' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T15:00:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { id: 'user1', email: 'user@example.com', name: 'Test User' },
      }])

      mockPrisma.reminderSettings.findUnique.mockResolvedValue(userSettings)

      // Mock listMember query for collaborators (empty array for this test)
      mockPrisma.listMember.findMany.mockResolvedValue([])

      // Set current time to exactly the reminder time
      vi.setSystemTime(new Date('2024-01-15T15:00:00Z'))

      await reminderService.processDueReminders()

      // Should send both push and email
      expect(mockPushService.sendNotification).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          title: 'Task Due Soon',
          body: 'Important Task is due at 11:00 AM',
          data: expect.objectContaining({
            taskId: 'task1',
            action: 'task_reminder',
          }),
        })
      )

      expect(mockEmailService.sendTaskReminder).toHaveBeenCalledWith({
        taskId: 'task1',
        title: 'Important Task',
        dueDateTime: task.dueDateTime,
        assigneeEmail: 'user@example.com',
        assigneeName: 'Test User',
        listNames: ['Work'],
        listId: 'list1',
        shortcode: undefined,
        collaborators: [],
      })
    })

    it('should respect quiet hours and reschedule reminder', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: false,
        defaultReminderTime: 60,
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'UTC',
        quietHoursStart: '22:00', // 10 PM
        quietHoursEnd: '08:00',   // 8 AM
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const task = {
        id: 'task1',
        title: 'Late Night Task',
        dueDateTime: new Date('2024-01-16T01:00:00Z'), // 1 AM UTC
        reminderTime: new Date('2024-01-16T00:00:00Z'), // 12 AM UTC (midnight - quiet hours)
        reminderType: 'push' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ name: 'Personal' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-16T00:00:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { email: 'user@example.com', name: 'Test User' },
      }])

      mockPrisma.reminderSettings.findUnique.mockResolvedValue(userSettings)

      // Set current time to the reminder time (during quiet hours)
      vi.setSystemTime(new Date('2024-01-16T00:00:00Z'))

      await reminderService.processDueReminders()

      // Should not send notification during quiet hours
      expect(mockPushService.sendNotification).not.toHaveBeenCalled()

      // Should reschedule reminder to end of quiet hours (8 AM), and release
      // the claim taken before sending — it was postponed, not delivered, so
      // it must be pending again for the run that covers its new time
      // (task 134bf288).
      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          scheduledFor: new Date('2024-01-16T08:00:00Z'),
          retryCount: 1,
          status: 'pending',
        },
      })
    })

    it('should handle timezone conversion correctly for different user timezones', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 30, // 30 minutes before
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'Asia/Tokyo', // JST (UTC+9)
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const task = {
        id: 'task1',
        title: 'Tokyo Meeting',
        dueDateTime: new Date('2024-01-15T06:00:00Z'), // 6 AM UTC = 3 PM JST
        reminderTime: new Date('2024-01-15T05:30:00Z'), // 5:30 AM UTC = 2:30 PM JST
        reminderType: 'both' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ name: 'Meetings' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T05:30:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { email: 'user@example.com', name: 'Test User' },
      }])

      mockPrisma.reminderSettings.findUnique.mockResolvedValue(userSettings)

      vi.setSystemTime(new Date('2024-01-15T05:30:00Z'))

      await reminderService.processDueReminders()

      expect(mockPushService.sendNotification).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          title: 'Task Due Soon',
          body: 'Tokyo Meeting is due at 3:00 PM', // Should show JST time
        })
      )
    })
  })

  describe('Daily Digest', () => {
    it('should send daily digest at user specified time in their timezone', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: true,
        dailyDigestTime: '09:00', // 9 AM
        dailyDigestTimezone: 'America/Los_Angeles', // PST/PDT
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const tasksToday = [
        {
          id: 'task1',
          title: 'Morning Task',
          dueDateTime: new Date('2024-01-15T17:00:00Z'), // Today
          assigneeId: 'user1',
          lists: [{ name: 'Work' }],
        },
      ]

      const tasksTomorrow = [
        {
          id: 'task2',
          title: 'Tomorrow Task',
          dueDateTime: new Date('2024-01-16T17:00:00Z'), // Tomorrow
          assigneeId: 'user1',
          lists: [{ name: 'Personal' }],
        },
      ]

      const overdueTasks = [
        {
          id: 'task3',
          title: 'Overdue Task',
          dueDateTime: new Date('2024-01-14T17:00:00Z'), // Yesterday
          assigneeId: 'user1',
          lists: [{ name: 'Important' }],
        },
      ]

      mockPrisma.user.findMany.mockResolvedValue([{
        id: 'user1',
        email: 'user@example.com',
        name: 'Test User',
        reminderSettings: userSettings,
      }])

      // Mock task queries for digest
      mockPrisma.task.findMany
        .mockResolvedValueOnce(tasksToday) // Due today
        .mockResolvedValueOnce(tasksTomorrow) // Due tomorrow
        .mockResolvedValueOnce(overdueTasks) // Overdue

      // Set time to 9:00 AM PST (17:00 UTC during standard time)
      vi.setSystemTime(new Date('2024-01-15T17:00:00Z'))

      await reminderService.processDailyDigests()

      expect(mockEmailService.sendDailyDigest).toHaveBeenCalledWith({
        userId: 'user1',
        userEmail: 'user@example.com',
        userName: 'Test User',
        dueTodayTasks: expect.arrayContaining([
          expect.objectContaining({ taskId: 'task1', title: 'Morning Task' })
        ]),
        dueTomorrowTasks: expect.arrayContaining([
          expect.objectContaining({ taskId: 'task2', title: 'Tomorrow Task' })
        ]),
        overdueTasks: expect.arrayContaining([
          expect.objectContaining({ taskId: 'task3', title: 'Overdue Task' })
        ]),
        upcomingTasks: [],
      })
    })

    it('should not send digest if user has disabled it', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: false, // Disabled
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'UTC',
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.user.findMany.mockResolvedValue([{
        id: 'user1',
        email: 'user@example.com',
        name: 'Test User',
        reminderSettings: userSettings,
      }])

      await reminderService.processDailyDigests()

      expect(mockEmailService.sendDailyDigest).not.toHaveBeenCalled()
    })
  })

  describe('Weekly Digest', () => {
    it('should send weekly digest with upcoming tasks due this week', async () => {
      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'UTC',
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const thisWeekTasks = [
        {
          id: 'task1',
          title: 'Wednesday Task',
          dueDateTime: new Date('2024-01-17T12:00:00Z'), // This Wednesday
          assigneeId: 'user1',
          lists: [{ name: 'Work' }],
        },
        {
          id: 'task2',
          title: 'Friday Task',
          dueDateTime: new Date('2024-01-19T15:00:00Z'), // This Friday
          assigneeId: 'user1',
          lists: [{ name: 'Projects' }],
        },
      ]

      mockPrisma.user.findMany.mockResolvedValue([{
        id: 'user1',
        email: 'user@example.com',
        name: 'Test User',
        reminderSettings: userSettings,
      }])

      mockPrisma.task.findMany.mockResolvedValue(thisWeekTasks)

      // Set to Monday (start of week) at digest time
      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      await reminderService.processWeeklyDigests()

      expect(mockEmailService.sendWeeklyDigest).toHaveBeenCalledWith({
        userId: 'user1',
        userEmail: 'user@example.com',
        userName: 'Test User',
        upcomingTasks: expect.arrayContaining([
          expect.objectContaining({ taskId: 'task1', title: 'Wednesday Task' }),
          expect.objectContaining({ taskId: 'task2', title: 'Friday Task' }),
        ]),
      })
    })
  })

  describe('Snooze Functionality', () => {
    it('should postpone reminder by specified duration', async () => {
      const originalReminderTime = new Date('2024-01-15T10:00:00Z')
      const snoozeMinutes = 30

      mockPrisma.reminderQueue.findUnique.mockResolvedValue({
        id: 'reminder1',
        retryCount: 0,
        data: {},
        scheduledFor: originalReminderTime,
      })

      mockPrisma.reminderQueue.update.mockResolvedValue({})

      const result = await reminderService.snoozeReminder('reminder1', snoozeMinutes)

      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          scheduledFor: new Date('2024-01-15T10:30:00Z'), // 30 minutes later
          retryCount: 1,
          data: expect.objectContaining({
            snoozedAt: expect.any(Date),
            snoozeCount: 1,
          }),
        },
      })

      expect(result.success).toBe(true)
    })

    it('should handle different snooze intervals', async () => {
      const testCases = [
        { minutes: 15, expected: '2024-01-15T10:15:00Z' },
        { minutes: 60, expected: '2024-01-15T11:00:00Z' },
        { minutes: 480, expected: '2024-01-15T18:00:00Z' }, // 8 hours
        { minutes: 1440, expected: '2024-01-16T10:00:00Z' }, // 1 day
      ]

      for (const testCase of testCases) {
        vi.clearAllMocks()
        await reminderService.snoozeReminder('reminder1', testCase.minutes)

        expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
          where: { id: 'reminder1' },
          data: expect.objectContaining({
            scheduledFor: new Date(testCase.expected),
          }),
        })
      }
    })

    it('should limit maximum snooze attempts', async () => {
      // Mock a reminder that has been snoozed too many times
      mockPrisma.reminderQueue.findUnique = vi.fn().mockResolvedValue({
        id: 'reminder1',
        retryCount: 5, // Already snoozed 5 times
        data: { snoozeCount: 5 },
      })

      const result = await reminderService.snoozeReminder('reminder1', 30)

      expect(result.success).toBe(false)
      expect(result.error).toContain('maximum snooze limit')
    })
  })

  describe('Reminder Validation', () => {
    it('should not send reminders too far in advance', async () => {
      const task = {
        id: 'task1',
        title: 'Future Task',
        dueDateTime: new Date('2024-01-25T18:00:00Z'), // 10 days from current time (too far)
        reminderTime: new Date('2024-01-15T08:00:00Z'), 
        reminderType: 'email' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ name: 'Work' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T08:00:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { email: 'user@example.com', name: 'Test User' },
      }])

      // Set current time to the reminder time
      vi.setSystemTime(new Date('2024-01-15T08:00:00Z'))

      await reminderService.processDueReminders()

      // Should not send reminder more than 7 days in advance
      expect(mockEmailService.sendTaskReminder).not.toHaveBeenCalled()
      
      // Should reschedule the reminder, and release the claim taken before
      // sending: postponed is not delivered, so it goes back to pending for
      // the run that covers its new time (task 134bf288).
      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          scheduledFor: new Date('2024-01-18T18:00:00.000Z'), // 7 days before due date
          status: 'pending',
        }
      })
    })

    it('should handle past due tasks appropriately', async () => {
      const task = {
        id: 'task1',
        title: 'Overdue Task',
        dueDateTime: new Date('2024-01-14T12:00:00Z'), // Yesterday
        reminderTime: new Date('2024-01-14T11:00:00Z'), // Yesterday
        reminderType: 'both' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ name: 'Urgent' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-14T11:00:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { email: 'user@example.com', name: 'Test User' },
      }])

      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'UTC',
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.reminderSettings.findUnique.mockResolvedValue(userSettings)

      await reminderService.processDueReminders()

      // Should send overdue notification with appropriate message
      expect(mockPushService.sendNotification).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          title: 'Task Overdue',
          body: expect.stringContaining('Overdue Task is overdue'),
        })
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle email sending failures gracefully', async () => {
      const task = {
        id: 'task1',
        title: 'Test Task',
        dueDateTime: new Date('2024-01-15T16:00:00Z'),
        reminderTime: new Date('2024-01-15T15:00:00Z'),
        reminderType: 'email' as const,
        reminderSent: false,
        assigneeId: 'user1',
        creatorId: 'user1',
        lists: [{ id: 'list1', name: 'Work' }],
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([{
        id: 'reminder1',
        taskId: 'task1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T15:00:00Z'),
        type: 'due_reminder',
        status: 'pending',
        task,
        user: { id: 'user1', email: 'user@example.com', name: 'Test User' },
      }])

      const userSettings: ReminderSettings = {
        id: 'settings1',
        userId: 'user1',
        enablePushReminders: false,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: true,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'UTC',
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.reminderSettings.findUnique.mockResolvedValue(userSettings)

      // Mock listMember query for collaborators (will be called before email send fails)
      mockPrisma.listMember.findMany.mockResolvedValue([])

      // Mock email service to throw error
      mockEmailService.sendTaskReminder.mockRejectedValue(new Error('Email service unavailable'))

      vi.setSystemTime(new Date('2024-01-15T15:00:00Z'))

      await reminderService.processDueReminders()

      // Should mark reminder as failed and increment retry count
      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          status: 'failed',
          retryCount: 1,
          data: expect.objectContaining({
            lastError: 'Email service unavailable',
            lastAttempt: expect.any(Date),
          }),
        },
      })
    })

    it('should retry failed reminders with exponential backoff', async () => {
      const failedReminder = {
        id: 'reminder1',
        retryCount: 2,
        status: 'failed',
        scheduledFor: new Date('2024-01-15T15:00:00Z'),
        data: { lastError: 'Network error' },
      }

      mockPrisma.reminderQueue.findMany.mockResolvedValue([failedReminder])

      await reminderService.retryFailedReminders()

      // Should reschedule with exponential backoff (4 minutes for retry 2: 2^2 = 4)
      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          scheduledFor: new Date('2024-01-15T10:04:00Z'), // 4 minutes later
          status: 'pending',
        },
      })
    })
  })
})