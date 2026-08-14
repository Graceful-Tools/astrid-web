/**
 * Task e0613ae5 — the task-copy flow, shared by the legacy and v1 copy routes.
 *
 * The pair was verified equivalent during the 28-pair audit before being
 * collapsed, so these tests pin the behaviour that was already there rather
 * than describing a change.
 *
 * The parts worth pinning are the ones a rewrite would plausibly drop: the
 * target-list permission rule (including the collaborative-public exception),
 * and the three best-effort steps that must never turn a successful copy into
 * a reported failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn() },
    task: { findUnique: vi.fn() },
  },
}))

const copyTask = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copy-utils', () => ({ copyTask }))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => ['owner-1', 'member-2', 'copier-1']),
}))

const invalidateUserStats = vi.hoisted(() => vi.fn())
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats }))

import { copyTaskForUser } from '@/lib/task-copy-flow'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)
const COPIER = 'copier-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'list-1' } as never)
  copyTask.mockResolvedValue({
    success: true,
    copiedTask: { id: 'copy-1', originalTaskId: 'task-1' },
  })
  mockPrisma.task.findUnique.mockResolvedValue({
    id: 'copy-1', title: 'Copied', creatorId: COPIER,
    lists: [{ id: 'list-1', name: 'Work' }],
    creator: { name: 'Copier' },
  } as never)
  invalidateUserStats.mockResolvedValue(undefined)
})

describe('copyTaskForUser (task e0613ae5)', () => {
  it('refuses a target list the caller cannot write to, without copying', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    const result = await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'not-mine' })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(copyTask).not.toHaveBeenCalled()
  })

  it('allows owner, member, or a COLLABORATIVE public list — and only those', async () => {
    await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    const where = (mockPrisma.taskList.findFirst.mock.calls[0][0] as never as {
      where: { OR: Record<string, unknown>[] }
    }).where
    expect(where.OR).toEqual([
      { ownerId: COPIER },
      { listMembers: { some: { userId: COPIER } } },
      { privacy: 'PUBLIC', publicListType: 'collaborative' },
    ])
    // Copy-only public lists are deliberately absent: only members may add
    // tasks there.
  })

  it('skips the permission check when no target list is given', async () => {
    await copyTaskForUser({ taskId: 't1', userId: COPIER })

    expect(mockPrisma.taskList.findFirst).not.toHaveBeenCalled()
    expect(copyTask).toHaveBeenCalled()
  })

  it('reports a copy failure as 400', async () => {
    copyTask.mockResolvedValue({ success: false, error: 'Access denied to copy this task' })

    const result = await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(result).toMatchObject({ ok: false, status: 400, error: 'Access denied to copy this task' })
  })

  it("invalidates the ORIGINAL creator's stats, not the copier's", async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce({ creatorId: 'original-author' } as never)

    await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(invalidateUserStats).toHaveBeenCalledWith('original-author')
  })

  it('still succeeds when stats invalidation throws', async () => {
    // Best-effort: the copy already happened. Failing here would report an
    // error for work that succeeded.
    mockPrisma.task.findUnique.mockResolvedValueOnce({ creatorId: 'original-author' } as never)
    invalidateUserStats.mockRejectedValue(new Error('redis down'))

    const result = await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(result.ok).toBe(true)
  })

  it('still succeeds when the broadcast throws', async () => {
    broadcastToUsers.mockImplementation(() => { throw new Error('sse down') })

    const result = await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(result.ok).toBe(true)
  })

  it('broadcasts to the other list members but not the copier', async () => {
    await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(broadcastToUsers).toHaveBeenCalledTimes(1)
    const recipients = broadcastToUsers.mock.calls[0][0] as string[]
    expect(recipients).toEqual(expect.arrayContaining(['owner-1', 'member-2']))
    expect(recipients).not.toContain(COPIER)
  })

  it('does not broadcast when there is no target list', async () => {
    await copyTaskForUser({ taskId: 't1', userId: COPIER })

    expect(broadcastToUsers).not.toHaveBeenCalled()
  })
})
