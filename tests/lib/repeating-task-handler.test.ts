import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'

// Mock Prisma before importing the handler
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { handleRepeatingTaskCompletion } from '@/lib/repeating-task-handler'
import { prisma } from '@/lib/prisma'

const mockPrisma = prisma as unknown as {
  task: {
    findUnique: Mock
    update: Mock
  }
}

describe('Repeating Task Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Timed tasks with COMPLETION_DATE mode', () => {
    it('should use completion date for timed daily tasks', async () => {
      // Timed task due Jan 10, 3pm UTC
      const dueDateTime = new Date('2026-01-10T15:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: false,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      // Complete 2 days late: Jan 12, 6pm UTC
      const originalDate = Date
      const completionTime = new Date('2026-01-12T18:00:00.000Z').getTime()
      global.Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(completionTime)
          } else {
            super(...(args as []))
          }
        }
        static now() {
          return completionTime
        }
      } as DateConstructor

      try {
        const result = await handleRepeatingTaskCompletion('test-task', false, true)

        expect(result?.shouldRollForward).toBe(true)
        expect(result?.nextDueDate).not.toBeNull()

        // COMPLETION_DATE mode: Next = completion date + 1 day, with original time
        // Jan 12 + 1 = Jan 13, at 3pm UTC
        const nextDate = result?.nextDueDate!
        expect(nextDate.getUTCDate()).toBe(13)
        expect(nextDate.getUTCHours()).toBe(15) // 3pm UTC preserved
      } finally {
        global.Date = originalDate
      }
    })
  })

  describe('Timed tasks with DUE_DATE mode', () => {
    it('should use due date for timed daily tasks', async () => {
      // Timed task due Jan 10, 3pm UTC
      const dueDateTime = new Date('2026-01-10T15:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'DUE_DATE',
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: false,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      // Complete 2 days late
      const originalDate = Date
      const completionTime = new Date('2026-01-12T18:00:00.000Z').getTime()
      global.Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(completionTime)
          } else {
            super(...(args as []))
          }
        }
        static now() {
          return completionTime
        }
      } as DateConstructor

      try {
        const result = await handleRepeatingTaskCompletion('test-task', false, true)

        expect(result?.shouldRollForward).toBe(true)
        expect(result?.nextDueDate).not.toBeNull()

        // DUE_DATE mode: Next = due date + 1 day
        // Jan 10 + 1 = Jan 11, at 3pm UTC
        const nextDate = result?.nextDueDate!
        expect(nextDate.getUTCDate()).toBe(11)
        expect(nextDate.getUTCHours()).toBe(15)
      } finally {
        global.Date = originalDate
      }
    })
  })

  describe('All-day tasks with DUE_DATE mode', () => {
    it('should roll forward from due date', async () => {
      const dueDateTime = new Date('2026-01-05T00:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'DUE_DATE',
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: true,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      const originalDate = Date
      const completionTime = new Date('2026-01-06T05:00:00.000Z').getTime()
      global.Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(completionTime)
          } else {
            super(...(args as []))
          }
        }
        static now() {
          return completionTime
        }
      } as DateConstructor

      try {
        const result = await handleRepeatingTaskCompletion('test-task', false, true)

        expect(result?.shouldRollForward).toBe(true)
        expect(result?.nextDueDate).not.toBeNull()

        // DUE_DATE mode: Jan 5 + 1 = Jan 6
        const nextDate = result?.nextDueDate!
        expect(nextDate.getUTCDate()).toBe(6)
        expect(nextDate.getUTCHours()).toBe(0)
      } finally {
        global.Date = originalDate
      }
    })
  })

  describe('All-day tasks with COMPLETION_DATE mode and localCompletionDate', () => {
    // This tests the fix for: "Completing daily repeating tasks in the evening PST
    // still creates next daily task day after instead of tomorrow"
    //
    // The fix: Client sends localCompletionDate (YYYY-MM-DD) and server uses it
    // for all-day tasks with COMPLETION_DATE mode

    it('should use localCompletionDate for all-day daily task when provided', async () => {
      // All-day task due "Jan 5" = Jan 5, 00:00:00 UTC
      const dueDateTime = new Date('2026-01-05T00:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: true,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      // User completes at Jan 5, 9pm PST = Jan 6, 5am UTC
      // But the client sends localCompletionDate = "2026-01-05" (the user's local date)
      const result = await handleRepeatingTaskCompletion(
        'test-task',
        false,
        true,
        '2026-01-05' // Local date from client
      )

      expect(result?.shouldRollForward).toBe(true)
      expect(result?.nextDueDate).not.toBeNull()

      // With localCompletionDate = Jan 5, next should be Jan 6
      // NOT Jan 7 (which would happen if using UTC date from server time)
      const nextDate = result?.nextDueDate!
      expect(nextDate.getUTCDate()).toBe(6) // Jan 6
      expect(nextDate.getUTCHours()).toBe(0) // Midnight UTC
    })

    it('should use server time when localCompletionDate is not provided (backward compat)', async () => {
      const dueDateTime = new Date('2026-01-05T00:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: true,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      // Simulate server time being Jan 6, 5am UTC (user completed at 9pm PST Jan 5)
      const originalDate = Date
      const completionTime = new Date('2026-01-06T05:00:00.000Z').getTime()
      global.Date = class extends originalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(completionTime)
          } else {
            super(...(args as []))
          }
        }
        static now() {
          return completionTime
        }
        static UTC = originalDate.UTC
      } as DateConstructor

      try {
        // No localCompletionDate provided - uses server time
        const result = await handleRepeatingTaskCompletion('test-task', false, true)

        expect(result?.shouldRollForward).toBe(true)
        expect(result?.nextDueDate).not.toBeNull()

        // Without localCompletionDate, server uses UTC date (Jan 6), next = Jan 7
        // This is the "buggy" behavior for old clients that don't send localCompletionDate
        const nextDate = result?.nextDueDate!
        expect(nextDate.getUTCDate()).toBe(7) // Jan 7 (server's UTC date + 1)
      } finally {
        global.Date = originalDate
      }
    })

    it('should NOT use localCompletionDate when repeatFrom is DUE_DATE', async () => {
      const dueDateTime = new Date('2026-01-05T00:00:00.000Z')

      const mockTask = {
        id: 'test-task',
        repeating: 'daily',
        repeatingData: null,
        repeatFrom: 'DUE_DATE', // DUE_DATE mode - should ignore localCompletionDate
        occurrenceCount: 0,
        dueDateTime,
        isAllDay: true,
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)

      // Even though localCompletionDate is provided, DUE_DATE mode should use due date
      const result = await handleRepeatingTaskCompletion(
        'test-task',
        false,
        true,
        '2026-01-10' // This should be ignored for DUE_DATE mode
      )

      expect(result?.shouldRollForward).toBe(true)
      expect(result?.nextDueDate).not.toBeNull()

      // DUE_DATE mode: Jan 5 + 1 = Jan 6
      const nextDate = result?.nextDueDate!
      expect(nextDate.getUTCDate()).toBe(6)
    })
  })
})
