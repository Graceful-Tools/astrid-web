/**
 * Task e0613ae5 — third slice of collapsing the duplicated legacy↔v1 routes.
 *
 * `PATCH /api/lists/:id/favorite` and its v1 twin were, again, two independent
 * copies of the same rule: access check, toggle, refetch with relations,
 * resolve `defaultAssignee`, hydrate per-user favorite state. Same treatment as
 * snooze and dismiss — the rule moves to lib/, each route keeps its own auth
 * and response shape.
 *
 * Two details worth pinning, because both are the kind of thing an extraction
 * silently loses:
 *   - `defaultAssigneeId` can hold the sentinel string "unassigned", which is
 *     NOT a user id. Looking it up would be a guaranteed miss on every list
 *     that uses the sentinel.
 *   - access is owner OR member; a list the user cannot see must 404 rather
 *     than toggling a favorite row for a list they have no business favoriting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/favorites', () => ({
  toggleFavorite: vi.fn(),
  hydrateSingleListFavorite: vi.fn(),
}))

import { setListFavorite } from '@/lib/list-favorite'
import { prisma } from '@/lib/prisma'
import { toggleFavorite, hydrateSingleListFavorite } from '@/lib/favorites'

const mockPrisma = vi.mocked(prisma)
const mockToggle = vi.mocked(toggleFavorite)
const mockHydrate = vi.mocked(hydrateSingleListFavorite)

const LIST = { id: 'list-1', name: 'Work', ownerId: 'owner-1', defaultAssigneeId: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findFirst.mockResolvedValue({ ...LIST } as never)
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
})

describe('setListFavorite (task e0613ae5)', () => {
  it('toggles and returns the refreshed list', async () => {
    const result = await setListFavorite({ userId: 'owner-1', listId: 'list-1', isFavorite: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mockToggle).toHaveBeenCalledWith('owner-1', 'list-1', true)
    expect(mockHydrate).toHaveBeenCalled()
    expect(result.list).toMatchObject({ id: 'list-1' })
  })

  it('404s a list the user can neither own nor see, without toggling anything', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    const result = await setListFavorite({ userId: 'stranger', listId: 'list-1', isFavorite: true })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockToggle).not.toHaveBeenCalled()
  })

  it('checks access as owner OR member', async () => {
    await setListFavorite({ userId: 'u-9', listId: 'list-1', isFavorite: false })

    const where = (mockPrisma.taskList.findFirst.mock.calls[0][0] as never as {
      where: { id: string; OR: Record<string, unknown>[] }
    }).where
    expect(where.id).toBe('list-1')
    expect(where.OR).toEqual([
      { ownerId: 'u-9' },
      { listMembers: { some: { userId: 'u-9' } } },
    ])
  })

  it('resolves a real defaultAssignee', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST, defaultAssigneeId: 'user-7' } as never)
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-7', name: 'Sam' } as never)

    const result = await setListFavorite({ userId: 'owner-1', listId: 'list-1', isFavorite: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.list as { defaultAssignee: unknown }).defaultAssignee).toMatchObject({ id: 'user-7' })
  })

  it('does NOT look up the "unassigned" sentinel as a user id', async () => {
    // "unassigned" is a sentinel, not an id. Querying it is a guaranteed miss
    // and an avoidable round trip on every list that uses it.
    mockPrisma.taskList.findUnique.mockResolvedValue({
      ...LIST, defaultAssigneeId: 'unassigned',
    } as never)

    const result = await setListFavorite({ userId: 'owner-1', listId: 'list-1', isFavorite: true })

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.list as { defaultAssignee: unknown }).defaultAssignee).toBeNull()
  })

  it('reports a 500 rather than throwing when the refetch comes back empty', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

    const result = await setListFavorite({ userId: 'owner-1', listId: 'list-1', isFavorite: true })

    expect(result).toMatchObject({ ok: false, status: 500 })
  })
})
