/**
 * Task e0613ae5 — who may mint a share link, shared by /api/shortcodes and
 * /api/v1/shortcodes.
 *
 * Creating a shortcode turns something private into something anyone with the
 * URL can reach, so these pin the boundary rather than the plumbing: the
 * creator shortcut, membership via any one containing list, and the deliberate
 * 404-not-403 for lists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    taskList: { findFirst: vi.fn() },
  },
}))

import { checkShortcodeTargetAccess } from '@/lib/shortcode-target-access'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)
const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkShortcodeTargetAccess (task e0613ae5)', () => {
  it('rejects a missing targetType or targetId without querying', async () => {
    expect(await checkShortcodeTargetAccess(undefined, 't1', USER))
      .toMatchObject({ ok: false, status: 400, message: 'targetType and targetId are required' })
    expect(await checkShortcodeTargetAccess('task', undefined, USER))
      .toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.task.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a targetType that is neither task nor list', async () => {
    const result = await checkShortcodeTargetAccess('project', 'p1', USER)

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(result.ok === false && result.message).toContain('must be')
    expect(mockPrisma.task.findUnique).not.toHaveBeenCalled()
  })

  it('404s a task that does not exist', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null as never)

    expect(await checkShortcodeTargetAccess('task', 't1', USER))
      .toMatchObject({ ok: false, status: 404, message: 'Task not found' })
  })

  it('lets the creator share their own task without checking any list', async () => {
    // Deliberate: a task on no list at all is still the creator's to share.
    mockPrisma.task.findUnique.mockResolvedValue({ creatorId: USER, lists: [] } as never)

    expect(await checkShortcodeTargetAccess('task', 't1', USER))
      .toEqual({ ok: true, targetType: 'task' })
    expect(mockPrisma.taskList.findFirst).not.toHaveBeenCalled()
  })

  it('lets a member of ANY containing list share the task', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      creatorId: 'someone-else',
      lists: [{ id: 'l1' }, { id: 'l2' }],
    } as never)
    mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'l2' } as never)

    expect(await checkShortcodeTargetAccess('task', 't1', USER))
      .toEqual({ ok: true, targetType: 'task' })

    const where = (mockPrisma.taskList.findFirst.mock.calls[0][0] as never as {
      where: { id: { in: string[] }; OR: unknown[] }
    }).where
    expect(where.id.in).toEqual(['l1', 'l2'])
    expect(where.OR).toEqual([
      { ownerId: USER },
      { listMembers: { some: { userId: USER } } },
    ])
  })

  it('403s a stranger on someone else\'s task', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      creatorId: 'someone-else',
      lists: [{ id: 'l1' }],
    } as never)
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    expect(await checkShortcodeTargetAccess('task', 't1', USER))
      .toMatchObject({ ok: false, status: 403, message: "You don't have access to this task" })
  })

  it('allows an owner or member to share a list', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'l1' } as never)

    expect(await checkShortcodeTargetAccess('list', 'l1', USER))
      .toEqual({ ok: true, targetType: 'list' })
  })

  it('answers 404, not 403, for a list the caller cannot reach', async () => {
    // So a non-member cannot distinguish an inaccessible list from a
    // nonexistent one.
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    expect(await checkShortcodeTargetAccess('list', 'l1', USER))
      .toMatchObject({ ok: false, status: 404, message: 'List not found or access denied' })
  })

  it('does not treat a PUBLIC list as shareable by a non-member', async () => {
    // Reading something is not the same as being able to mint a share link for
    // it, so PUBLIC is absent from the qualifying clauses entirely.
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    await checkShortcodeTargetAccess('list', 'l1', USER)

    const where = (mockPrisma.taskList.findFirst.mock.calls[0][0] as never as {
      where: { OR: Record<string, unknown>[] }
    }).where
    expect(where.OR).toEqual([
      { ownerId: USER },
      { listMembers: { some: { userId: USER } } },
    ])
  })
})
