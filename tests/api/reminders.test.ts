import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as snoozeHandler } from '@/app/api/reminders/[id]/snooze/route'
import { POST as dismissHandler } from '@/app/api/reminders/[id]/dismiss/route'
import { GET as statusHandler } from '@/app/api/reminders/status/route'

// Mock dependencies
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth-config', () => ({
  authConfig: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderQueue: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

const mockGetServerSession = getServerSession as any
const mockPrisma = prisma as any

describe('Reminder API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user1', email: 'test@example.com' },
    })
  })

  describe('POST /api/reminders/[id]/snooze', () => {
    it('should snooze reminder for 15 minutes', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T10:00:00Z'),
        retryCount: 0,
        data: {},
      }

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)
      mockPrisma.reminderQueue.update.mockResolvedValue({
        ...mockReminder,
        scheduledFor: new Date('2024-01-15T10:15:00Z'),
      })

      const request = new NextRequest('http://localhost/api/reminders/reminder1/snooze', {
        method: 'POST',
        body: JSON.stringify({ minutes: 15 }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await snoozeHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(mockPrisma.reminderQueue.update).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
        data: {
          scheduledFor: expect.any(Date),
          retryCount: 1,
          status: 'pending',
          data: expect.objectContaining({
            snoozedAt: expect.any(Date),
            snoozeCount: 1,
            originalScheduledFor: expect.any(Date),
          }),
        },
      })
    })

    it('should reject snooze if reminder does not belong to user', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'other-user',
        scheduledFor: new Date('2024-01-15T10:00:00Z'),
      }

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)

      const request = new NextRequest('http://localhost/api/reminders/reminder1/snooze', {
        method: 'POST',
        body: JSON.stringify({ minutes: 15 }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await snoozeHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })

      expect(response.status).toBe(403)
    })

    it('should reject snooze after maximum attempts', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T10:00:00Z'),
        retryCount: 3,
        data: { snoozeCount: 5 }, // Already snoozed 5 times
      }

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)

      const request = new NextRequest('http://localhost/api/reminders/reminder1/snooze', {
        method: 'POST',
        body: JSON.stringify({ minutes: 30 }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await snoozeHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toContain('maximum snooze limit')
    })

    it('should validate snooze duration limits', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'user1',
        scheduledFor: new Date('2024-01-15T10:00:00Z'),
        retryCount: 0,
        data: {},
      }

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)

      // Test invalid durations
      const invalidDurations = [-5, 0, 10081] // negative, zero, too long (> 1 week)

      for (const minutes of invalidDurations) {
        const request = new NextRequest('http://localhost/api/reminders/reminder1/snooze', {
          method: 'POST',
          body: JSON.stringify({ minutes }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await snoozeHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })
        expect(response.status).toBe(400)
      }
    })
  })

  describe('POST /api/reminders/[id]/dismiss', () => {
    it('should dismiss reminder permanently', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'user1',
        taskId: 'task1',
      }

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)
      mockPrisma.reminderQueue.delete.mockResolvedValue(mockReminder)
      mockPrisma.reminderQueue.count.mockResolvedValue(0)
      mockPrisma.task.update.mockResolvedValue({ id: 'task1' })

      const request = new NextRequest('http://localhost/api/reminders/reminder1/dismiss', {
        method: 'POST',
      })

      const response = await dismissHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(mockPrisma.reminderQueue.delete).toHaveBeenCalledWith({
        where: { id: 'reminder1' },
      })
    })

    it('should dismiss all reminders for a task when dismissAll is true', async () => {
      const mockReminder = {
        id: 'reminder1',
        userId: 'user1',
        taskId: 'task1',
      }

      const mockTaskReminders = [
        { id: 'reminder1', taskId: 'task1', userId: 'user1' },
        { id: 'reminder2', taskId: 'task1', userId: 'user1' },
      ]

      mockPrisma.reminderQueue.findUnique.mockResolvedValue(mockReminder)
      mockPrisma.reminderQueue.findMany.mockResolvedValue(mockTaskReminders)
      mockPrisma.reminderQueue.deleteMany.mockResolvedValue({ count: 2 })
      mockPrisma.task.update.mockResolvedValue({ id: 'task1' })

      const request = new NextRequest('http://localhost/api/reminders/reminder1/dismiss', {
        method: 'POST',
        body: JSON.stringify({ dismissAll: true }),
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await dismissHandler(request, { params: Promise.resolve({ id: 'reminder1' }) })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(result.dismissedCount).toBe(2)
    })
  })

  describe('GET /api/reminders/status', () => {
    it('should return upcoming reminders for user', async () => {
      const mockReminders = [
        {
          id: 'reminder1',
          scheduledFor: new Date('2024-01-15T15:00:00Z'),
          type: 'due_reminder',
          task: {
            id: 'task1',
            title: 'Important Task',
            dueDateTime: new Date('2024-01-15T16:00:00Z'),
            lists: [{ name: 'Work' }],
          },
        },
        {
          id: 'reminder2',
          scheduledFor: new Date('2024-01-16T09:00:00Z'),
          type: 'daily_digest',
        },
      ]

      mockPrisma.reminderQueue.findMany.mockResolvedValue(mockReminders)
      mockPrisma.reminderQueue.groupBy.mockResolvedValue([
        { type: 'due_reminder', _count: { _all: 1 } },
        { type: 'daily_digest', _count: { _all: 1 } }
      ])

      const request = new NextRequest('http://localhost/api/reminders/status')
      const response = await statusHandler(request)
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.reminders).toHaveLength(2)
      expect(result.reminders[0]).toMatchObject({
        id: 'reminder1',
        type: 'due_reminder',
        scheduledFor: '2024-01-15T15:00:00.000Z',
        task: expect.objectContaining({
          title: 'Important Task',
        }),
      })
    })

    it('should filter reminders by type when specified', async () => {
      const mockReminders = [
        {
          id: 'reminder1',
          scheduledFor: new Date('2024-01-15T15:00:00Z'),
          type: 'due_reminder',
          task: { id: 'task1', title: 'Task 1' },
        },
      ]

      mockPrisma.reminderQueue.findMany.mockResolvedValue(mockReminders)
      mockPrisma.reminderQueue.groupBy.mockResolvedValue([
        { type: 'due_reminder', _count: { _all: 1 } }
      ])

      const request = new NextRequest('http://localhost/api/reminders/status?type=due_reminder')
      const response = await statusHandler(request)

      expect(mockPrisma.reminderQueue.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user1',
          status: 'pending',
          type: 'due_reminder',
          scheduledFor: { gte: expect.any(Date) },
        },
        include: expect.any(Object),
        orderBy: { scheduledFor: 'asc' },
        take: 50,
      })
    })
  })

  describe('Reminder Preferences Integration', () => {
    it('should respect user preferences when processing reminders', async () => {
      // This would be tested in the reminder service, but we can test
      // that the API correctly handles preference-related data
      mockPrisma.reminderQueue.findMany.mockResolvedValue([])
      mockPrisma.reminderQueue.groupBy.mockResolvedValue([])
      
      const request = new NextRequest('http://localhost/api/reminders/status')
      const response = await statusHandler(request)

      expect(response.status).toBe(200)
      // Additional assertions would depend on how preferences are returned
    })
  })
})