/**
 * Task 017a569a, service-layer slice 1.
 *
 * These pin the access rule itself, which two routes had been re-implementing
 * and one route had skipped entirely. The include-shape case is the important
 * one: it is the failure that has already shipped twice, and it is invisible
 * because it fails CLOSED for members and open for nobody — so it looks like a
 * permissions quirk rather than a missing relation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { task: { findUnique } } }))

import { getTaskForUser } from '@/services/task.service'

const USER = 'user-1'
const OTHER = 'user-2'

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    creatorId: OTHER,
    assigneeId: null,
    lists: [],
    ...overrides,
  }
}

/** A list on which `userId` is a plain member, in the shape the rule reads. */
function listWithMember(userId: string) {
  return {
    id: 'list-1',
    ownerId: 'someone-else',
    owner: { id: 'someone-else' },
    listMembers: [{ userId, role: 'member', user: { id: userId } }],
  }
}

beforeEach(() => vi.clearAllMocks())

describe('getTaskForUser (task 017a569a)', () => {
  it('404s a task that does not exist', async () => {
    findUnique.mockResolvedValue(null)

    expect(await getTaskForUser('nope', USER)).toEqual({
      ok: false,
      status: 404,
      error: 'Task not found',
    })
  })

  it('allows the creator', async () => {
    findUnique.mockResolvedValue(task({ creatorId: USER }))

    const result = await getTaskForUser('task-1', USER)
    expect(result.ok).toBe(true)
  })

  it('allows the assignee', async () => {
    findUnique.mockResolvedValue(task({ assigneeId: USER }))

    expect((await getTaskForUser('task-1', USER)).ok).toBe(true)
  })

  it('allows a plain MEMBER of a list the task is on', async () => {
    findUnique.mockResolvedValue(task({ lists: [listWithMember(USER)] }))

    // The regression that has shipped twice: this only works when the fetch
    // included lists.listMembers. The service owns the include, so a caller
    // cannot get this wrong by fetching a thinner shape.
    expect((await getTaskForUser('task-1', USER)).ok).toBe(true)
  })

  it('allows the owner of a list the task is on', async () => {
    findUnique.mockResolvedValue(
      task({ lists: [{ id: 'list-1', ownerId: USER, owner: { id: USER }, listMembers: [] }] })
    )

    expect((await getTaskForUser('task-1', USER)).ok).toBe(true)
  })

  it('403s a stranger', async () => {
    findUnique.mockResolvedValue(task({ lists: [listWithMember(OTHER)] }))

    expect(await getTaskForUser('task-1', USER)).toEqual({
      ok: false,
      status: 403,
      error: 'Access denied',
    })
  })

  it('403s on a PUBLIC list rather than treating public as access', async () => {
    // Deliberate: every caller so far ACTS on the task. Public-list readability
    // is a read concern and would need its own function — a flag here would let
    // a caller widen a write to public readers by passing the wrong argument.
    findUnique.mockResolvedValue(
      task({
        lists: [{ id: 'list-1', ownerId: OTHER, owner: { id: OTHER }, privacy: 'PUBLIC', listMembers: [] }],
      })
    )

    expect((await getTaskForUser('task-1', USER)).ok).toBe(false)
  })

  it('fetches with the relations the rule reads', async () => {
    findUnique.mockResolvedValue(task({ creatorId: USER }))

    await getTaskForUser('task-1', USER)

    const include = findUnique.mock.calls[0][0].include
    // Asserted structurally: dropping listMembers here is precisely the bug of
    // task 73733c3d, and it would otherwise only show as a member being denied.
    expect(include.lists.include.listMembers).toBeTruthy()
    expect(include.lists.include.owner).toBeTruthy()
  })
})
