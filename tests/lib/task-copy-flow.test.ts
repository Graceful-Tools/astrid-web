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

const invalidateUserStats = vi.hoisted(() => vi.fn())
vi.mock('@/lib/user-stats', () => ({ invalidateUserStats }))

import { copyTaskForUser } from '@/lib/task-copy-flow'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)
const COPIER = 'copier-1'
const READABLE_SOURCE = { creatorId: COPIER, assigneeId: null, isPrivate: false, lists: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'list-1' } as never)
  copyTask.mockResolvedValue({
    success: true,
    copiedTask: { id: 'copy-1', originalTaskId: 'task-1' },
  })
  mockPrisma.task.findUnique.mockResolvedValue({
    id: 'copy-1', title: 'Copied', creatorId: COPIER,
    lists: [{ id: 'list-1', name: 'Work', privacy: 'PRIVATE', ownerId: COPIER, listMembers: [] }],
    creator: { name: 'Copier' },
  } as never)
  invalidateUserStats.mockResolvedValue(undefined)
})

/**
 * AWTD-1530 (Copilot on #668): the single-task copy checked only the destination. Anyone who knew
 * a private task's id could copy its title, description, comments and, with this change, its
 * comment files. The source must be readable: the batch copy's rule (public and not private, or
 * creator, assignee or a list role).
 */
describe('copyTaskForUser reads only a source the caller can see (AWTD-1530)', () => {
  function source(overrides: Record<string, unknown>) {
    return {
      id: 'task-1', creatorId: 'someone-else', assigneeId: null, isPrivate: false,
      lists: [{ id: 'theirs', privacy: 'PRIVATE', ownerId: 'someone-else', listMembers: [] }],
      ...overrides,
    }
  }

  it('refuses a private task on someone else\'s list, without copying', async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce(source({}) as never)
    const result = await copyTaskForUser({ taskId: 'task-1', userId: COPIER, includeComments: true })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(copyTask).not.toHaveBeenCalled()
  })

  it('refuses a task marked private even on a public list', async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce(source({
      isPrivate: true,
      lists: [{ id: 'pub', privacy: 'PUBLIC', ownerId: 'someone-else', listMembers: [] }],
    }) as never)
    const result = await copyTaskForUser({ taskId: 'task-1', userId: COPIER })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(copyTask).not.toHaveBeenCalled()
  })

  it('allows a task on a public list, and one on a list the caller is a member of', async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce(source({
      lists: [{ id: 'pub', privacy: 'PUBLIC', ownerId: 'someone-else', listMembers: [] }],
    }) as never)
    expect((await copyTaskForUser({ taskId: 'task-1', userId: COPIER })).ok).toBe(true)

    mockPrisma.task.findUnique.mockResolvedValueOnce(source({
      lists: [{ id: 'shared', privacy: 'PRIVATE', ownerId: 'someone-else', listMembers: [{ userId: COPIER, role: 'member' }] }],
    }) as never)
    expect((await copyTaskForUser({ taskId: 'task-1', userId: COPIER })).ok).toBe(true)
  })

  it('a missing source is not found', async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce(null as never)
    const result = await copyTaskForUser({ taskId: 'gone', userId: COPIER })
    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(copyTask).not.toHaveBeenCalled()
  })
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
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(READABLE_SOURCE as never) // the source access check (AWTD-1530)
      .mockResolvedValueOnce({ creatorId: 'original-author' } as never)

    await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(invalidateUserStats).toHaveBeenCalledWith('original-author')
  })

  it('still succeeds when stats invalidation throws', async () => {
    // Best-effort: the copy already happened. Failing here would report an
    // error for work that succeeded.
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(READABLE_SOURCE as never) // the source access check (AWTD-1530)
      .mockResolvedValueOnce({ creatorId: 'original-author' } as never)
    invalidateUserStats.mockRejectedValue(new Error('redis down'))

    const result = await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(result.ok).toBe(true)
  })

  it('sends no event of its own — the create path does (AWTD-1124)', async () => {
    // copyTask creates through services/task-bulk-create, which broadcasts
    // task_created to the list's members. A second send here delivered every
    // copy twice.
    await copyTaskForUser({ taskId: 't1', userId: COPIER, targetListId: 'list-1' })

    expect(broadcastToUsers).not.toHaveBeenCalled()
  })
})
