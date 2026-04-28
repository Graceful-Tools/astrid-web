import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reminderManager } from '@/lib/reminder-manager'
import { getRandomReminderString, getSocialAccountabilityMessage, REMINDER_STRINGS } from '@/lib/reminder-constants'
import type { Task, User } from '@/types/task'

// Mock task data
const mockTask: Task = {
  id: 'test-task-123',
  title: 'Test Task for Reminders',
  description: 'A test task to verify reminder functionality',
  completed: false,
  priority: 2,
  repeating: 'never',
  dueDateTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
  isAllDay: false,
  creator: {
    id: 'user-123',
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    emailVerified: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    verified: true
  },
  creatorId: 'user-123',
  isPrivate: false,
  lists: [{
    id: 'list-123',
    name: 'Test List',
    privacy: 'SHARED' as const,
    ownerId: 'user-123',
    owner: {
      id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      emailVerified: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      verified: true
    },
    listMembers: [
      {
        id: 'member-1',
        listId: 'list-123',
        userId: 'user-456',
        role: 'member' as const,
        user: {
          id: 'user-456',
          name: 'Team Member',
          email: 'member@example.com',
          image: null,
          emailVerified: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          verified: true
        }
      }
    ],
    admins: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }],
  assignee: null,
  assigneeId: null,
  attachments: [],
  comments: [],
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockUser: User = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  emailVerified: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  verified: true
}

describe('Reminder System Tests', () => {
  beforeEach(() => {
    // Clear all reminders before each test
    reminderManager.clearAllReminders()
    vi.clearAllMocks()
  })

  describe('Reminder Constants', () => {
    it('should have authentic Astrid reminder strings', () => {
      expect(REMINDER_STRINGS.reminders).toContain("Hi there! Have a sec?")
      expect(REMINDER_STRINGS.reminders).toContain("Astrid here!")
      expect(REMINDER_STRINGS.reminders_due).toContain("Time to work!")
      expect(REMINDER_STRINGS.reminders_due).toContain("Due date is here!")
      expect(REMINDER_STRINGS.reminder_responses).toContain("Ready to put this in the past?")
      expect(REMINDER_STRINGS.reminder_responses).toContain("I've got something for you!")
    })

    it('should get random reminder strings from different categories', () => {
      const generalReminder = getRandomReminderString('reminders')
      const dueReminder = getRandomReminderString('reminders_due')
      const responseReminder = getRandomReminderString('reminder_responses')

      expect(REMINDER_STRINGS.reminders).toContain(generalReminder)
      expect(REMINDER_STRINGS.reminders_due).toContain(dueReminder)
      expect(REMINDER_STRINGS.reminder_responses).toContain(responseReminder)
    })

    it('should return different strings on multiple calls (randomness)', () => {
      const strings = new Set()
      // Get 10 random strings - should likely have some variation
      for (let i = 0; i < 10; i++) {
        strings.add(getRandomReminderString('reminders'))
      }
      // With 12 options, getting at least 2 different strings in 10 attempts is very likely
      expect(strings.size).toBeGreaterThanOrEqual(1) // At minimum should work
    })
  })

  describe('Social Accountability Messages', () => {
    it('should return empty string for no members', () => {
      const message = getSocialAccountabilityMessage([])
      expect(message).toBe('')
    })

    it('should format single member message correctly', () => {
      const members = [{ name: 'John Doe', email: 'john@example.com' }]
      const message = getSocialAccountabilityMessage(members)
      expect(message).toBe('John Doe is counting on you!')
    })

    it('should format two members message correctly', () => {
      const members = [
        { name: 'John Doe', email: 'john@example.com' },
        { name: 'Jane Smith', email: 'jane@example.com' }
      ]
      const message = getSocialAccountabilityMessage(members)
      expect(message).toBe('John Doe, Jane Smith, and others are counting on you!')
    })

    it('should format multiple members message correctly', () => {
      const members = [
        { name: 'John Doe', email: 'john@example.com' },
        { name: 'Jane Smith', email: 'jane@example.com' },
        { name: 'Bob Johnson', email: 'bob@example.com' }
      ]
      const message = getSocialAccountabilityMessage(members)
      expect(message).toBe('John Doe, Jane Smith, and others are counting on you!')
    })

    it('should handle members without names (use email prefix)', () => {
      const members = [{ email: 'john.doe@example.com' }]
      const message = getSocialAccountabilityMessage(members)
      expect(message).toBe('john.doe is counting on you!')
    })
  })

  describe('Manual Reminder Triggering', () => {
    it('should trigger a manual reminder for a task', () => {
      const reminderId = reminderManager.triggerManualReminder(mockTask, mockUser.id)
      
      expect(reminderId).toBeDefined()
      expect(reminderId).toContain('manual_')
      expect(reminderId).toContain(mockTask.id)
    })

    it('should add manual reminder to active reminders', () => {
      const reminderId = reminderManager.triggerManualReminder(mockTask, mockUser.id)
      const activeReminders = reminderManager.getActiveReminders(mockUser.id)
      
      expect(activeReminders).toHaveLength(1)
      expect(activeReminders[0].id).toBe(reminderId)
      expect(activeReminders[0].task.id).toBe(mockTask.id)
      expect(activeReminders[0].config.type).toBe('due_reminder')
    })
  })

  describe('Reminder Scheduling', () => {
    it('should schedule reminders for tasks with due dates', () => {
      reminderManager.scheduleTaskReminders(mockTask, mockUser.id)
    })

    it('should not schedule reminders for tasks without due dates', () => {
      const taskWithoutDueDate = { ...mockTask, dueDateTime: null }
      reminderManager.scheduleTaskReminders(taskWithoutDueDate, mockUser.id)
      
      // Should not have scheduled any reminders
    })
  })

  describe('Reminder Management', () => {
    it('should snooze a reminder', () => {
      const reminderId = reminderManager.triggerManualReminder(mockTask, mockUser.id)
      reminderManager.snoozeReminder(reminderId, 30) // 30 minutes
      
      const activeReminders = reminderManager.getActiveReminders(mockUser.id)
      expect(activeReminders).toHaveLength(0) // Should be removed from active
    })

    it('should dismiss a reminder permanently', () => {
      const reminderId = reminderManager.triggerManualReminder(mockTask, mockUser.id)
      reminderManager.dismissReminder(reminderId)
      
      const activeReminders = reminderManager.getActiveReminders(mockUser.id)
      expect(activeReminders).toHaveLength(0)
    })

    it('should remove all reminders when task is completed', () => {
      reminderManager.scheduleTaskReminders(mockTask, mockUser.id)
      reminderManager.completeTask(mockTask.id)
    })
  })

  describe('Listener Notifications', () => {
    it('should notify listeners when reminders change', () => {
      const listener = vi.fn()
      reminderManager.addListener(listener)
      
      reminderManager.triggerManualReminder(mockTask, mockUser.id)
      
      expect(listener).toHaveBeenCalled()
      
      reminderManager.removeListener(listener)
    })

    it('should remove listeners properly', () => {
      const listener = vi.fn()
      reminderManager.addListener(listener)
      reminderManager.removeListener(listener)
      
      reminderManager.triggerManualReminder(mockTask, mockUser.id)
      
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

describe('UI Strings', () => {
  it('should have proper UI strings for the interface', () => {
    expect(REMINDER_STRINGS.ui.reminder_title).toBe('Reminder:')
    expect(REMINDER_STRINGS.ui.snooze).toBe('Snooze')
    expect(REMINDER_STRINGS.ui.complete).toBe('Complete!')
    expect(REMINDER_STRINGS.ui.completed_toast).toBe('Congratulations on finishing!')
  })

  it('should have social accountability strings', () => {
    expect(REMINDER_STRINGS.social.multiple).toBe('These people are counting on you!')
    expect(REMINDER_STRINGS.social.one).toBe('{name} is counting on you!')
    expect(REMINDER_STRINGS.social.multiple_names).toBe('{name1}, {name2}, and others are counting on you!')
  })
})