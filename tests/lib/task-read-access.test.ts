/**
 * Task 92e582c6 — v1 read access must match legacy's four-way test.
 *
 * `GET /api/tasks/[id]` (legacy) grants view access to creator, assignee,
 * list owner/member, OR anyone signed in when a task sits on a PUBLIC list.
 * `requireTaskAccess` has no PUBLIC branch, so v1 answered 403 where legacy
 * answered 200 — which is why the share-code landing page could not be moved
 * off legacy, and why `/api/tasks/[id]` could not be retired.
 *
 * The fix is a separate READ helper rather than widening `requireTaskAccess`:
 * that function also guards PUT and DELETE, and legacy's own PUT does not have
 * the PUBLIC branch. Read widens; write must not. Both halves are asserted
 * here, because "we added the branch" and "we added it only to reads" are
 * different claims and only the second one is safe.
 *
 * The prisma mock evaluates the `where` it is handed against fixture rows
 * rather than asserting on query shape, so these tests describe who gets in,
 * not how the query is spelled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { task: { findFirst: vi.fn() } },
}))

import { requireTaskAccess, requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

type ListRow = {
  id: string
  ownerId: string
  privacy: string
  listMembers: { userId: string }[]
}
type TaskRow = {
  id: string
  creatorId: string
  assigneeId: string | null
  lists: ListRow[]
}

const PUBLIC_TASK: TaskRow = {
  id: 'task-public',
  creatorId: 'owner-1',
  assigneeId: null,
  lists: [
    {
      id: 'list-public',
      ownerId: 'owner-1',
      privacy: 'PUBLIC',
      listMembers: [{ userId: 'owner-1' }],
    },
  ],
}

const PRIVATE_TASK: TaskRow = {
  ...PUBLIC_TASK,
  id: 'task-private',
  lists: [{ ...PUBLIC_TASK.lists[0], id: 'list-private', privacy: 'PRIVATE' }],
}

const ROWS = [PUBLIC_TASK, PRIVATE_TASK]

/** Does one list satisfy a (possibly nested) list condition? */
function listMatches(list: ListRow, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === 'OR') return (value as Record<string, unknown>[]).some((c) => listMatches(list, c))
    if (key === 'ownerId') return list.ownerId === value
    if (key === 'privacy') return list.privacy === value
    if (key === 'listMembers') {
      const some = (value as { some: { userId: string } }).some
      return list.listMembers.some((m) => m.userId === some.userId)
    }
    throw new Error(`unhandled list condition: ${key}`)
  })
}

/** Does the task satisfy one branch of the top-level OR? */
function branchMatches(task: TaskRow, branch: Record<string, unknown>): boolean {
  return Object.entries(branch).every(([key, value]) => {
    if (key === 'creatorId') return task.creatorId === value
    if (key === 'assigneeId') return task.assigneeId === value
    if (key === 'lists') {
      const some = (value as { some: Record<string, unknown> }).some
      return task.lists.some((l) => listMatches(l, some))
    }
    throw new Error(`unhandled task condition: ${key}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.task.findFirst).mockImplementation((async (args: {
    where: { id: string; OR: Record<string, unknown>[] }
  }) => {
    const row = ROWS.find((t) => t.id === args.where.id)
    if (!row) return null
    return args.where.OR.some((branch) => branchMatches(row, branch)) ? row : null
  }) as never)
})

describe('requireTaskReadAccess — public-list parity with legacy (task 92e582c6)', () => {
  it('lets a signed-in non-member read a task on a PUBLIC list', async () => {
    // The whole bug: legacy says yes here, v1 said 403, and the share-code
    // page exists precisely for this audience.
    await expect(requireTaskReadAccess('stranger-1', 'task-public')).resolves.toBeUndefined()
  })

  it('still refuses a signed-in non-member on a PRIVATE list', async () => {
    await expect(requireTaskReadAccess('stranger-1', 'task-private')).rejects.toThrow(
      /Access denied/,
    )
  })

  it('still lets the creator read a private task', async () => {
    await expect(requireTaskReadAccess('owner-1', 'task-private')).resolves.toBeUndefined()
  })

  it('refuses when the task does not exist', async () => {
    await expect(requireTaskReadAccess('owner-1', 'no-such-task')).rejects.toThrow(
      /Access denied/,
    )
  })
})

describe('requireTaskAccess — the write path must NOT widen (task 92e582c6)', () => {
  it('keeps refusing a non-member on a PUBLIC list', async () => {
    // Legacy's PUT has no PUBLIC branch either. If this ever passes, a
    // stranger can edit or delete any task on any public list.
    await expect(requireTaskAccess('stranger-1', 'task-public')).rejects.toThrow(
      /Access denied/,
    )
  })

  it('still admits the creator', async () => {
    await expect(requireTaskAccess('owner-1', 'task-public')).resolves.toBeUndefined()
  })
})
