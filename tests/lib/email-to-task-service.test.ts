/**
 * Email-to-Task Service Tests
 *
 * Tests for processing inbound emails and creating tasks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emailToTaskService, type ParsedEmail } from '@/lib/email-to-task-service'
import { prisma } from '@/lib/prisma'
import { placeholderUserService } from '@/lib/placeholder-user-service'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      create: vi.fn(),
    },
    taskList: {
      create: vi.fn(),
      update: vi.fn(),
    },
    listMember: {
      createMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/placeholder-user-service', () => ({
  placeholderUserService: {
    findUserByEmail: vi.fn(),
    findOrCreatePlaceholderUser: vi.fn(),
    findOrCreateMultiplePlaceholderUsers: vi.fn(),
  },
}))

describe('EmailToTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('processEmail - Self Task', () => {
    it('should create self-task when remindme@astrid.cc is in TO', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: ['remindme@astrid.cc'],
        cc: [],
        bcc: [],
        subject: 'Buy groceries',
        body: 'Milk, eggs, bread',
      }

      const mockSender = {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_week',
        defaultDueTime: '17:00',
        emailToTaskListId: null,
      }

      const mockTask = {
        id: 'task-1',
        title: 'Buy groceries',
        description: 'Milk, eggs, bread',
        creatorId: 'user-1',
        assigneeId: 'user-1',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(prisma.task.create).mockResolvedValue(mockTask as any)

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeTruthy()
      expect(result?.routing).toBe('self')
      expect(result?.task.title).toBe('Buy groceries')
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Buy groceries',
          description: 'Milk, eggs, bread',
          creatorId: 'user-1',
          assigneeId: 'user-1',
        }),
        include: expect.anything(),
      })
    })

    it('should return null if user has email-to-task disabled', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: ['remindme@astrid.cc'],
        cc: [],
        bcc: [],
        subject: 'Test',
        body: 'Test',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue({
        id: 'user-1',
        emailToTaskEnabled: false,
      } as any)

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeNull()
      expect(prisma.task.create).not.toHaveBeenCalled()
    })

    it('should clean subject line (remove RE: and FW:)', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: ['remindme@astrid.cc'],
        cc: [],
        bcc: [],
        subject: 'RE: FW: Original Task',
        body: 'Content',
      }

      const mockSender = {
        id: 'user-1',
        email: 'user@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_week',
        defaultDueTime: '17:00',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(prisma.task.create).mockResolvedValue({ id: 'task-1', title: 'Original Task' } as any)

      await emailToTaskService.processEmail(email)

      const callArgs = vi.mocked(prisma.task.create).mock.calls[0][0]
      expect(callArgs.data.title).toBe('Original Task')
      expect(callArgs.include).toBeDefined()
    })
  })

  describe('processEmail - Assigned Task', () => {
    it('should create assigned task when remindme@astrid.cc is in CC with single recipient', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['assignee@example.com'],
        cc: ['remindme@astrid.cc'],
        bcc: [],
        subject: 'Please review document',
        body: 'Document attached',
      }

      const mockSender = {
        id: 'sender-1',
        email: 'sender@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '3_days',
        defaultDueTime: '17:00',
      }

      const mockAssignee = {
        id: 'assignee-1',
        email: 'assignee@example.com',
        isPlaceholder: true,
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(placeholderUserService.findOrCreatePlaceholderUser).mockResolvedValue(mockAssignee as any)
      vi.mocked(prisma.task.create).mockResolvedValue({ id: 'task-1' } as any)

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeTruthy()
      expect(result?.routing).toBe('assigned')
      expect(result?.createdUsers).toHaveLength(1)
      expect(result?.createdUsers[0].email).toBe('assignee@example.com')
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assigneeId: 'assignee-1',
        }),
        include: expect.anything(),
      })
    })
  })

  describe('processEmail - Group Task', () => {
    it('should create shared list and group task when multiple recipients', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['user1@example.com', 'user2@example.com'],
        cc: ['remindme@astrid.cc', 'user3@example.com'],
        bcc: [],
        subject: 'Team meeting notes',
        body: 'Please review',
      }

      const mockSender = {
        id: 'sender-1',
        email: 'sender@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_week',
        defaultDueTime: '17:00',
      }

      const mockRecipients = [
        { id: 'user-1', email: 'user1@example.com', isPlaceholder: true },
        { id: 'user-2', email: 'user2@example.com', isPlaceholder: false },
        { id: 'user-3', email: 'user3@example.com', isPlaceholder: true },
      ]

      const mockList = {
        id: 'list-1',
        name: 'Team meeting notes (3 people)',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(placeholderUserService.findOrCreateMultiplePlaceholderUsers).mockResolvedValue(mockRecipients as any)
      vi.mocked(prisma.taskList.create).mockResolvedValue(mockList as any)
      vi.mocked(prisma.taskList.update).mockResolvedValue(mockList as any)
      vi.mocked(prisma.task.create).mockResolvedValue({ id: 'task-1' } as any)

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeTruthy()
      expect(result?.routing).toBe('group')
      expect(result?.list).toBeTruthy()
      expect(result?.list?.name).toBe('Team meeting notes (3 people)')
      expect(result?.createdUsers).toHaveLength(2) // Only placeholders

      // Verify list is created (members added separately via listMember.createMany)
      expect(prisma.taskList.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Team meeting notes (3 people)',
          ownerId: 'sender-1',
        }),
        include: expect.anything(),
      })

      // Verify admin users added as list members (NEW system)
      expect(prisma.listMember.createMany).toHaveBeenCalled()

      // Verify users are created with listId
      expect(placeholderUserService.findOrCreateMultiplePlaceholderUsers).toHaveBeenCalledWith(
        ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        'sender-1',
        'list-1' // listId should be passed for invitations
      )

      // Note: Recipients are added as admins via listMember.createMany, not taskList.update
      // (legacy admins.connect pattern removed)

      const callArgs = vi.mocked(prisma.task.create).mock.calls[0][0]
      expect(callArgs.data.assigneeId).toBe('user-1') // First recipient from TO line
      expect(callArgs.data.lists).toEqual({ connect: [{ id: 'list-1' }] })
      expect(callArgs.include).toBeDefined()
    })

    it('should exclude sender and remindme from recipient list', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['sender@example.com', 'user1@example.com'],
        cc: ['remindme@astrid.cc'],
        bcc: [],
        subject: 'Test',
        body: 'Test',
      }

      const mockSender = {
        id: 'sender-1',
        email: 'sender@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_week',
        defaultDueTime: '17:00',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(placeholderUserService.findOrCreateMultiplePlaceholderUsers).mockImplementation(async (emails) => {
        // Should only include user1@example.com
        expect(emails).toEqual(['user1@example.com'])
        return [{ id: 'user-1', email: 'user1@example.com' }] as any
      })
      vi.mocked(prisma.taskList.create).mockResolvedValue({ id: 'list-1' } as any)
      vi.mocked(prisma.taskList.update).mockResolvedValue({ id: 'list-1' } as any)
      vi.mocked(prisma.task.create).mockResolvedValue({ id: 'task-1' } as any)

      await emailToTaskService.processEmail(email)

      expect(placeholderUserService.findOrCreateMultiplePlaceholderUsers).toHaveBeenCalledWith(
        ['user1@example.com'],
        'sender-1',
        'list-1'
      )
    })

    it('should assign to first person in TO line, not CC line', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['first-to@example.com', 'second-to@example.com'],
        cc: ['remindme@astrid.cc', 'first-cc@example.com'],
        bcc: [],
        subject: 'Assignment priority test',
        body: 'Test',
      }

      const mockSender = {
        id: 'sender-1',
        email: 'sender@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_week',
        defaultDueTime: '17:00',
      }

      const mockRecipients = [
        { id: 'to-1', email: 'first-to@example.com', isPlaceholder: true },
        { id: 'to-2', email: 'second-to@example.com', isPlaceholder: true },
        { id: 'cc-1', email: 'first-cc@example.com', isPlaceholder: true },
      ]

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(placeholderUserService.findOrCreateMultiplePlaceholderUsers).mockResolvedValue(mockRecipients as any)
      vi.mocked(prisma.taskList.create).mockResolvedValue({ id: 'list-1' } as any)
      vi.mocked(prisma.taskList.update).mockResolvedValue({ id: 'list-1' } as any)
      vi.mocked(prisma.task.create).mockResolvedValue({ id: 'task-1' } as any)

      await emailToTaskService.processEmail(email)

      // Verify recipients are in TO-first order
      expect(placeholderUserService.findOrCreateMultiplePlaceholderUsers).toHaveBeenCalledWith(
        ['first-to@example.com', 'second-to@example.com', 'first-cc@example.com'],
        'sender-1',
        'list-1'
      )

      // Verify task is assigned to first person from TO line
      const taskCallArgs = vi.mocked(prisma.task.create).mock.calls[0][0]
      expect(taskCallArgs.data.assigneeId).toBe('to-1') // first-to@example.com
    })
  })

  describe('Due Date Calculation', () => {
    it('should calculate due date based on user offset', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: ['remindme@astrid.cc'],
        cc: [],
        bcc: [],
        subject: 'Test task',
        body: 'Test',
      }

      const mockSender = {
        id: 'user-1',
        email: 'user@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: '1_day',
        defaultDueTime: '09:00',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(prisma.task.create).mockImplementation(async (args: any) => {
        const dueDate = args.data.dueDateTime
        expect(dueDate).toBeTruthy()

        // Should be ~1 day from now at 9 AM
        const now = new Date()
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        const dueDateObj = new Date(dueDate)

        expect(dueDateObj.getHours()).toBe(9)
        expect(dueDateObj.getMinutes()).toBe(0)
        expect(dueDateObj.getDate()).toBe(tomorrow.getDate())

        return { id: 'task-1' } as any
      })

      await emailToTaskService.processEmail(email)
    })

    it('should handle "none" due date offset', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: ['remindme@astrid.cc'],
        cc: [],
        bcc: [],
        subject: 'Test task',
        body: 'Test',
      }

      const mockSender = {
        id: 'user-1',
        email: 'user@example.com',
        emailToTaskEnabled: true,
        defaultTaskDueOffset: 'none',
        defaultDueTime: '17:00',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(mockSender as any)
      vi.mocked(prisma.task.create).mockImplementation(async (args: any) => {
        expect(args.data.dueDateTime).toBeNull()
        return { id: 'task-1' } as any
      })

      await emailToTaskService.processEmail(email)
    })
  })

  describe('sender authentication (task 0a5b6337)', () => {
    const spoofed = (senderAuth: unknown): ParsedEmail => ({
      senderAuth: senderAuth as never,
      from: 'victim@example.com',
      to: ['remindme@astrid.cc'],
      cc: [],
      bcc: [],
      subject: 'Buy milk',
      body: 'please',
    })

    it('creates no task and no user when the message failed DKIM', async () => {
      // From is unauthenticated. Acting on it lets anyone impersonate any user,
      // and the group routing would then create a shared list inviting every
      // recipient.
      const result = await emailToTaskService.processEmail(
        spoofed({ spf: 'pass', dkim: 'fail' })
      )

      expect(result).toBeNull()
      expect(prisma.task.create).not.toHaveBeenCalled()
      // Never mint a placeholder account for an address that has not proved it
      // exists — that is what turns a spoofed From into a permanent user.
      expect(placeholderUserService.findUserByEmail).not.toHaveBeenCalled()
      expect(placeholderUserService.findOrCreatePlaceholderUser).not.toHaveBeenCalled()
    })

    it('creates nothing when the provider reported no verdict at all', async () => {
      // The dangerous default: an absent header must not read as a pass.
      const result = await emailToTaskService.processEmail(spoofed(undefined))

      expect(result).toBeNull()
      expect(prisma.task.create).not.toHaveBeenCalled()
      expect(placeholderUserService.findUserByEmail).not.toHaveBeenCalled()
    })
  })
})
