/**
 * Email-to-Task Service Tests
 *
 * Tests for processing inbound emails and creating tasks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row } from '../fixtures/prisma-rows'
import { emailToTaskService, type ParsedEmail } from '@/lib/email-to-task-service'
import { prisma } from '@/lib/prisma'
import { placeholderUserService } from '@/lib/placeholder-user-service'
import { BRAND } from '@/lib/brand/config'

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

// Tasks are created through the task service (identifier, reminders,
// broadcast, assignee rules) — spec §5.2 step 5. These tests assert what the
// service is asked for.
const { createTaskWithSideEffects } = vi.hoisted(() => ({ createTaskWithSideEffects: vi.fn() }))
vi.mock('@/services/task.service', () => ({ createTaskWithSideEffects }))

const created = (task: unknown) => ({ ok: true, task, idempotent: false })
const createCall = () => createTaskWithSideEffects.mock.calls[0][0]

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
    it(`should create self-task when remindme@${BRAND.domain} is in TO`, async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: [`remindme@${BRAND.domain}`],
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
      createTaskWithSideEffects.mockResolvedValue(created(mockTask as any))

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeTruthy()
      expect(result?.routing).toBe('self')
      expect(result?.task.title).toBe('Buy groceries')
      expect(createTaskWithSideEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          input: expect.objectContaining({
            title: 'Buy groceries',
            description: 'Milk, eggs, bread',
            assigneeId: 'user-1',
          }),
        }),
      )
    })

    it('should return null if user has email-to-task disabled', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: [`remindme@${BRAND.domain}`],
        cc: [],
        bcc: [],
        subject: 'Test',
        body: 'Test',
      }

      vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue(row({
        id: 'user-1',
        emailToTaskEnabled: false,
      }))

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeNull()
      expect(createTaskWithSideEffects).not.toHaveBeenCalled()
    })

    it('should clean subject line (remove RE: and FW:)', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: [`remindme@${BRAND.domain}`],
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
      createTaskWithSideEffects.mockResolvedValue(created(row({ id: 'task-1', title: 'Original Task' })))

      await emailToTaskService.processEmail(email)

      expect(createCall().input.title).toBe('Original Task')
    })
  })

  describe('processEmail - Assigned Task', () => {
    it(`should create assigned task when remindme@${BRAND.domain} is in CC with single recipient`, async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['assignee@example.com'],
        cc: [`remindme@${BRAND.domain}`],
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
      createTaskWithSideEffects.mockResolvedValue(created(row({ id: 'task-1' })))

      const result = await emailToTaskService.processEmail(email)

      expect(result).toBeTruthy()
      expect(result?.routing).toBe('assigned')
      expect(result?.createdUsers).toHaveLength(1)
      expect(result?.createdUsers[0].email).toBe('assignee@example.com')
      expect(createCall().input.assigneeId).toBe('assignee-1')
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
        cc: [`remindme@${BRAND.domain}`, 'user3@example.com'],
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
      createTaskWithSideEffects.mockResolvedValue(created(row({ id: 'task-1' })))

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

      expect(createCall().input.assigneeId).toBe('user-1') // First recipient from TO line
      expect(createCall().input.listIds).toEqual(['list-1'])
    })

    it('should exclude sender and remindme from recipient list', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'sender@example.com',
        to: ['sender@example.com', 'user1@example.com'],
        cc: [`remindme@${BRAND.domain}`],
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
      vi.mocked(prisma.taskList.create).mockResolvedValue(row({ id: 'list-1' }))
      vi.mocked(prisma.taskList.update).mockResolvedValue(row({ id: 'list-1' }))
      createTaskWithSideEffects.mockResolvedValue(created(row({ id: 'task-1' })))

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
        cc: [`remindme@${BRAND.domain}`, 'first-cc@example.com'],
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
      vi.mocked(prisma.taskList.create).mockResolvedValue(row({ id: 'list-1' }))
      vi.mocked(prisma.taskList.update).mockResolvedValue(row({ id: 'list-1' }))
      createTaskWithSideEffects.mockResolvedValue(created(row({ id: 'task-1' })))

      await emailToTaskService.processEmail(email)

      // Verify recipients are in TO-first order
      expect(placeholderUserService.findOrCreateMultiplePlaceholderUsers).toHaveBeenCalledWith(
        ['first-to@example.com', 'second-to@example.com', 'first-cc@example.com'],
        'sender-1',
        'list-1'
      )

      // Verify task is assigned to first person from TO line
      expect(createCall().input.assigneeId).toBe('to-1') // first-to@example.com
    })
  })

  describe('Due Date Calculation', () => {
    it('should calculate due date based on user offset', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: [`remindme@${BRAND.domain}`],
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
      createTaskWithSideEffects.mockImplementation((async (args: { input: Record<string, unknown> }) => {
        const dueDate = args.input.dueDateTime
        expect(dueDate).toBeTruthy()

        // Should be ~1 day from now at 9 AM
        const now = new Date()
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        const dueDateObj = new Date(dueDate as string | number | Date)

        expect(dueDateObj.getHours()).toBe(9)
        expect(dueDateObj.getMinutes()).toBe(0)
        expect(dueDateObj.getDate()).toBe(tomorrow.getDate())

        return created({ id: 'task-1' })
      }) as never)

      await emailToTaskService.processEmail(email)
      expect(createTaskWithSideEffects).toHaveBeenCalled()
    })

    it('should handle "none" due date offset', async () => {
      const email: ParsedEmail = {
        // The provider's SPF/DKIM/DMARC verdict. processEmail refuses to act as
        // the From address without one (task 0a5b6337).
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com',
        to: [`remindme@${BRAND.domain}`],
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
      createTaskWithSideEffects.mockImplementation((async (args: { input: Record<string, unknown> }) => {
        expect(args.input.dueDateTime).toBeNull()
        return created({ id: 'task-1' })
      }) as never)

      await emailToTaskService.processEmail(email)
      expect(createTaskWithSideEffects).toHaveBeenCalled()
    })
  })

  describe('sender authentication (task 0a5b6337)', () => {
    const spoofed = (senderAuth: unknown): ParsedEmail => ({
      senderAuth: senderAuth as never,
      from: 'victim@example.com',
      to: [`remindme@${BRAND.domain}`],
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
      expect(createTaskWithSideEffects).not.toHaveBeenCalled()
      // Never mint a placeholder account for an address that has not proved it
      // exists — that is what turns a spoofed From into a permanent user.
      expect(placeholderUserService.findUserByEmail).not.toHaveBeenCalled()
      expect(placeholderUserService.findOrCreatePlaceholderUser).not.toHaveBeenCalled()
    })

    it('creates nothing when the provider reported no verdict at all', async () => {
      // The dangerous default: an absent header must not read as a pass.
      const result = await emailToTaskService.processEmail(spoofed(undefined))

      expect(result).toBeNull()
      expect(createTaskWithSideEffects).not.toHaveBeenCalled()
      expect(placeholderUserService.findUserByEmail).not.toHaveBeenCalled()
    })
  })
})

describe('email-to-task creates through the task service (spec §5.2 step 5)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never writes the task row itself', async () => {
    vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue({
      id: 'user-1', email: 'user@example.com', emailToTaskEnabled: true,
      defaultTaskDueOffset: 'none', emailToTaskListId: null,
    } as any)
    createTaskWithSideEffects.mockResolvedValue(created({ id: 'task-1', title: 'Hello' }))

    await emailToTaskService.processEmail({
      senderAuth: { spf: 'pass', dkim: 'pass' },
      from: 'user@example.com', to: [`remindme@${BRAND.domain}`], cc: [], bcc: [],
      subject: 'Hello', body: 'World',
    })

    expect(prisma.task.create).not.toHaveBeenCalled()
    expect(createTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', requireAssigneeListMembership: false }),
    )
  })

  it('surfaces a refused create instead of pretending it worked', async () => {
    vi.mocked(placeholderUserService.findUserByEmail).mockResolvedValue({
      id: 'user-1', email: 'user@example.com', emailToTaskEnabled: true,
      defaultTaskDueOffset: 'none', emailToTaskListId: null,
    } as any)
    createTaskWithSideEffects.mockResolvedValue({ ok: false, status: 403, error: 'nope' })

    await expect(
      emailToTaskService.processEmail({
        senderAuth: { spf: 'pass', dkim: 'pass' },
        from: 'user@example.com', to: [`remindme@${BRAND.domain}`], cc: [], bcc: [],
        subject: 'Hello', body: 'World',
      }),
    ).rejects.toThrow('nope')
  })
})
