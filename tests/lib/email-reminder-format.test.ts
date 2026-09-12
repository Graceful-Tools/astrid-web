import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EmailReminderService } from '@/lib/email-reminder-service'
import type { DailyDigestData, TaskReminderData } from '@/types/reminder'

describe('EmailReminderService - Email Format', () => {
  let service: EmailReminderService
  let mockDate: Date

  beforeEach(() => {
    service = new EmailReminderService()
    mockDate = new Date('2024-12-01T10:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createMockTask = (overrides?: Partial<TaskReminderData>): TaskReminderData => ({
    taskId: 'task-1',
    title: 'Test Task',
    listNames: ['Work'],
    dueDateTime: new Date('2024-12-01T15:00:00Z'),
    assigneeEmail: 'test@example.com',
    assigneeName: 'Test User',
    collaborators: [],
    ...overrides,
  })

  describe('Daily Digest Subject Line', () => {
    it('should format subject as "Reminders for <date>"', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const sendEmailSpy = vi.spyOn(service as any, 'sendEmail')
      await service.sendDailyDigest(data)

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringMatching(/^Reminders for (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}$/),
        })
      )
    })
  })

  describe('Daily Digest HTML Format', () => {
    it('should include localized long-form date header', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('Sunday')
      expect(html).toContain('December')
      expect(html).toContain('2024')
    })

    it('should include Astrid greeting and signature', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('Astrid here,')
      expect(html).toContain('Reminding you about the things that are important to you.')
      expect(html).toContain('- Astrid')
    })

    it('should render tasks as clickable rows with checkboxes', async () => {
      const task = createMockTask({ taskId: 'task-123', title: 'Buy groceries' })
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [task],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('class="task-row"')
      expect(html).toContain('class="task-checkbox"')
      expect(html).toContain('Buy groceries')
      expect(html).toContain('/tasks/task-123')
    })

    it('should apply correct priority colors to checkboxes', async () => {
      const overdueTask = createMockTask({
        taskId: 'overdue-1',
        title: 'Overdue Task',
        dueDateTime: new Date('2024-11-30T10:00:00Z')
      })
      const todayTask = createMockTask({
        taskId: 'today-1',
        title: 'Today Task',
        dueDateTime: new Date('2024-12-01T10:00:00Z')
      })
      const tomorrowTask = createMockTask({
        taskId: 'tomorrow-1',
        title: 'Tomorrow Task',
        dueDateTime: new Date('2024-12-02T10:00:00Z')
      })

      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [overdueTask],
        dueTodayTasks: [todayTask],
        dueTomorrowTasks: [tomorrowTask],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('#ef4444')
      expect(html).toContain('#f59e0b')
      expect(html).toContain('#10b981')
    })

    it('should include unsubscribe link in footer', async () => {
      const data: DailyDigestData = {
        userId: 'user-123',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('Unsubscribe from email reminders')
      expect(html).toContain('/api/settings/reminders/unsubscribe')
      expect(html).toContain('userId=user-123')
    })

    it('should include footer instructions text', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('Click on checkboxes to mark task as complete or task name to view / edit.')
    })

    it('should render task list without calendar icons', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).not.toContain('📅')
      expect(html).not.toContain('📋')
      expect(html).not.toContain('🗓️')
      expect(html).not.toContain('⚠️')
    })

    it('should make task titles clickable with correct URLs', async () => {
      const task = createMockTask({ taskId: 'task-456' })
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [task],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      expect(html).toContain('href=')
      expect(html).toContain('/tasks/task-456')
    })

    it('should combine all task types in order', async () => {
      const overdueTask = createMockTask({
        taskId: 'overdue-1',
        title: 'Overdue Task',
        dueDateTime: new Date('2024-11-30T10:00:00Z')
      })
      const todayTask = createMockTask({
        taskId: 'today-1',
        title: 'Today Task'
      })
      const tomorrowTask = createMockTask({
        taskId: 'tomorrow-1',
        title: 'Tomorrow Task',
        dueDateTime: new Date('2024-12-02T10:00:00Z')
      })

      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [overdueTask],
        dueTodayTasks: [todayTask],
        dueTomorrowTasks: [tomorrowTask],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)

      const overdueIndex = html.indexOf('Overdue Task')
      const todayIndex = html.indexOf('Today Task')
      const tomorrowIndex = html.indexOf('Tomorrow Task')

      expect(overdueIndex).toBeLessThan(todayIndex)
      expect(todayIndex).toBeLessThan(tomorrowIndex)
    })
  })

  describe('Daily Digest Plain Text Format', () => {
    it('should include localized date header in plain text', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const text = (service as any).getDailyDigestText(data)

      expect(text).toContain('Sunday')
      expect(text).toContain('December')
      expect(text).toContain('2024')
    })

    it('should include Astrid greeting and signature in plain text', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const text = (service as any).getDailyDigestText(data)

      expect(text).toContain('Astrid here,')
      expect(text).toContain('Reminding you about the things that are important to you.')
      expect(text).toContain('- Astrid')
    })

    it('should include task URLs in plain text', async () => {
      const task = createMockTask({ taskId: 'task-789', title: 'Test Task' })
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [task],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const text = (service as any).getDailyDigestText(data)

      expect(text).toContain('/tasks/task-789')
      expect(text).toContain('Test Task')
    })

    it('should include unsubscribe URL in plain text', async () => {
      const data: DailyDigestData = {
        userId: 'user-456',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const text = (service as any).getDailyDigestText(data)

      expect(text).toContain('/api/settings/reminders/unsubscribe')
      expect(text).toContain('userId=user-456')
    })

    it('should include footer instructions in plain text', async () => {
      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [createMockTask()],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const text = (service as any).getDailyDigestText(data)

      expect(text).toContain('Click on checkboxes to mark task as complete or task name to view / edit.')
    })
  })

  describe('Task URL Generation (Regression Test for Bug #404)', () => {
    it('should use shortcode URL format when shortcode is available', async () => {
      const task = createMockTask({
        taskId: 'task-123',
        listId: 'list-456',
        shortcode: 'FCKzrnYg'
      })

      const html = (service as any).getTaskReminderHtml(task)
      const text = (service as any).getTaskReminderText(task)

      // Should use shortcode format
      expect(html).toContain('/s/FCKzrnYg')
      expect(html).not.toContain('/tasks/task-123')
      expect(text).toContain('/s/FCKzrnYg')
      expect(text).not.toContain('/tasks/task-123')
    })

    it('should use list URL with task param when listId is available but no shortcode', async () => {
      const task = createMockTask({
        taskId: 'ecce0d80-e566-4217-a394-e965974a6ae1',
        listId: '9491ff15-d887-4ad5-9f7a-5b26fd7f1a2c',
        shortcode: undefined
      })

      const html = (service as any).getTaskReminderHtml(task)
      const text = (service as any).getTaskReminderText(task)

      // Should use list URL with task parameter
      expect(html).toContain('/lists/9491ff15-d887-4ad5-9f7a-5b26fd7f1a2c?task=ecce0d80-e566-4217-a394-e965974a6ae1')
      expect(html).not.toContain('/tasks/ecce0d80-e566-4217-a394-e965974a6ae1')
      expect(text).toContain('/lists/9491ff15-d887-4ad5-9f7a-5b26fd7f1a2c?task=ecce0d80-e566-4217-a394-e965974a6ae1')
      expect(text).not.toContain('/tasks/ecce0d80-e566-4217-a394-e965974a6ae1')
    })

    it('should fallback to task URL when neither listId nor shortcode is available', async () => {
      const task = createMockTask({
        taskId: 'task-789',
        listId: undefined,
        shortcode: undefined
      })

      const html = (service as any).getTaskReminderHtml(task)
      const text = (service as any).getTaskReminderText(task)

      // Should use fallback task URL format
      expect(html).toContain('/tasks/task-789')
      expect(text).toContain('/tasks/task-789')
    })

    it('should use list URL with task param in daily digest when listId is available', async () => {
      const task = createMockTask({
        taskId: 'task-abc',
        listId: 'list-xyz',
        shortcode: undefined
      })

      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [task],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)
      const text = (service as any).getDailyDigestText(data)

      // Should use list URL with task parameter, not the broken /tasks/task-abc format
      expect(html).toContain('/lists/list-xyz?task=task-abc')
      expect(html).not.toContain('/tasks/task-abc')
      expect(text).toContain('/lists/list-xyz?task=task-abc')
      expect(text).not.toContain('/tasks/task-abc')
    })

    it('should use shortcode in daily digest when available', async () => {
      const task = createMockTask({
        taskId: 'task-def',
        listId: 'list-ghi',
        shortcode: 'AbC123'
      })

      const data: DailyDigestData = {
        userId: 'user-1',
        userEmail: 'test@example.com',
        userName: 'Test User',
        overdueTasks: [],
        dueTodayTasks: [task],
        dueTomorrowTasks: [],
        upcomingTasks: [],
      }

      const html = (service as any).getDailyDigestHtml(data)
      const text = (service as any).getDailyDigestText(data)

      // Should prefer shortcode over list URL
      expect(html).toContain('/s/AbC123')
      expect(html).not.toContain('/lists/list-ghi')
      expect(html).not.toContain('/tasks/task-def')
      expect(text).toContain('/s/AbC123')
      expect(text).not.toContain('/lists/list-ghi')
      expect(text).not.toContain('/tasks/task-def')
    })

    it('should append action=snooze correctly to shortcode URLs', async () => {
      const task = createMockTask({
        taskId: 'task-snooze',
        listId: 'list-123',
        shortcode: 'SnOoZe'
      })

      const html = (service as any).getTaskReminderHtml(task)
      const text = (service as any).getTaskReminderText(task)

      // Snooze URL should append ?action=snooze to shortcode URL
      expect(html).toContain('/s/SnOoZe?action=snooze')
      expect(text).toContain('/s/SnOoZe?action=snooze')
    })

    it('should append action=snooze correctly to list URLs with existing query param', async () => {
      const task = createMockTask({
        taskId: 'task-snooze2',
        listId: 'list-456',
        shortcode: undefined
      })

      const html = (service as any).getTaskReminderHtml(task)
      const text = (service as any).getTaskReminderText(task)

      // Snooze URL should append &action=snooze to list URL that already has ?task=
      expect(html).toContain('/lists/list-456?task=task-snooze2&action=snooze')
      expect(text).toContain('/lists/list-456?task=task-snooze2&action=snooze')
    })
  })
})
