/**
 * AWTD-1644 — a read-only (`viewer`) list member must not pass the task WRITE
 * check, while still passing the READ check.
 *
 * `getUserRoleInList` makes a viewer seat read-only (AWTD-1318), but the API
 * write boundary admitted any ListMember row. The prisma mock evaluates the
 * `where` it is handed against fixture rows, so these tests describe who gets
 * in, not how the query is spelled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { task: { findFirst: vi.fn() } },
}))

import { requireTaskAccess, requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

type Cond = Record<string, unknown>
type ListRow = {
  ownerId: string
  privacy: string
  listMembers: { userId: string; role: string }[]
  project?: { ownerId: string; members: { userId: string }[] }
}
type TaskRow = { id: string; creatorId: string; assigneeId: string | null; lists: ListRow[] }

const list = (over: Partial<ListRow>): ListRow => ({
  ownerId: 'owner-1',
  privacy: 'PRIVATE',
  listMembers: [],
  ...over,
})
const task = (id: string, l: ListRow): TaskRow => ({
  id,
  creatorId: 'owner-1',
  assigneeId: null,
  lists: [l],
})

const ROWS = [
  task('t-viewer', list({ listMembers: [{ userId: 'viewer-1', role: 'viewer' }] })),
  task('t-viewer-upper', list({ listMembers: [{ userId: 'viewer-1', role: 'VIEWER' }] })),
  task('t-member', list({ listMembers: [{ userId: 'member-1', role: 'member' }] })),
  task(
    't-viewer-project',
    list({
      listMembers: [{ userId: 'viewer-1', role: 'viewer' }],
      project: { ownerId: 'owner-1', members: [{ userId: 'viewer-1' }] },
    }),
  ),
]

function stringMatches(actual: string, cond: unknown): boolean {
  if (typeof cond === 'string') return actual === cond
  const c = cond as { equals?: string; mode?: string }
  if (c.equals !== undefined) {
    return c.mode === 'insensitive' ? actual.toLowerCase() === c.equals.toLowerCase() : actual === c.equals
  }
  throw new Error('unhandled string condition')
}

function memberMatches(m: { userId: string; role: string }, cond: Cond): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === 'userId') return m.userId === value
    if (key === 'NOT') return !memberMatches(m, value as Cond)
    if (key === 'role') return stringMatches(m.role, value)
    throw new Error(`unhandled member condition: ${key}`)
  })
}

function listMatches(l: ListRow, cond: Cond): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === 'OR') return (value as Cond[]).some((c) => listMatches(l, c))
    if (key === 'ownerId') return l.ownerId === value
    if (key === 'privacy') return l.privacy === value
    if (key === 'listType') return false
    if (key === 'listMembers') {
      return l.listMembers.some((m) => memberMatches(m, (value as { some: Cond }).some))
    }
    if (key === 'project') {
      if (!l.project) return false
      const p = value as { ownerId?: string; members?: { some: { userId: string } } }
      if (p.ownerId !== undefined) return l.project.ownerId === p.ownerId
      if (p.members) return l.project.members.some((m) => m.userId === p.members!.some.userId)
      return false
    }
    throw new Error(`unhandled list condition: ${key}`)
  })
}

function branchMatches(t: TaskRow, branch: Cond): boolean {
  return Object.entries(branch).every(([key, value]) => {
    if (key === 'creatorId') return t.creatorId === value
    if (key === 'assigneeId') return t.assigneeId === value
    if (key === 'lists') return t.lists.some((l) => listMatches(l, (value as { some: Cond }).some))
    throw new Error(`unhandled task condition: ${key}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.task.findFirst).mockImplementation((async (args: {
    where: { id: string; OR: Cond[] }
  }) => {
    const row = ROWS.find((t) => t.id === args.where.id)
    if (!row) return null
    return args.where.OR.some((b) => branchMatches(row, b)) ? row : null
  }) as never)
})

describe('viewer list seats are read-only through the task API (AWTD-1644)', () => {
  it('refuses a viewer-only member a write', async () => {
    await expect(requireTaskAccess('viewer-1', 't-viewer')).rejects.toThrow(/Access denied/)
  })

  it('refuses an uppercase VIEWER row a write too', async () => {
    await expect(requireTaskAccess('viewer-1', 't-viewer-upper')).rejects.toThrow(/Access denied/)
  })

  it('still lets the viewer read', async () => {
    await expect(requireTaskReadAccess('viewer-1', 't-viewer')).resolves.toBeUndefined()
  })

  it('still lets a plain member write', async () => {
    await expect(requireTaskAccess('member-1', 't-member')).resolves.toBeUndefined()
  })

  it('lets a viewer who is also a project member write', async () => {
    await expect(requireTaskAccess('viewer-1', 't-viewer-project')).resolves.toBeUndefined()
  })
})
