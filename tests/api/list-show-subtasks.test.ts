import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/lists/[id]/route'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

/**
 * Task dce843a1 — per-list `showSubtasks` on the LEGACY list route.
 *
 * This route matters as much as v1 here: the web client's own
 * `handleUpdateList` PUTs the entire TaskList object to
 * `/api/lists/:id`. Without a boolean guard the web app is exactly the
 * "older client sending a whole list object" the field has to survive —
 * every unrelated settings save would rewrite the toggle.
 */

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    listMember: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

const mockUser = { id: 'user-123', email: 'test@example.com', name: 'Test User' }

const existingList = {
  id: 'list-123',
  name: 'Test List',
  ownerId: mockUser.id,
  listType: 'regular',
  privacy: 'PRIVATE',
  showSubtasks: true,
  admins: [],
  members: [],
  listMembers: [],
}

function makePut(body: unknown) {
  return new NextRequest('http://localhost/api/lists/list-123', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function updateData() {
  return (vi.mocked(prisma.taskList.update) as any).mock.calls[0][0].data
}

describe('PUT /api/lists/[id] — showSubtasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
    ;(prisma.$transaction as any).mockImplementation((operation: any) => operation(prisma))
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(existingList as any)
    vi.mocked(prisma.taskList.update).mockResolvedValue({
      ...existingList,
      owner: mockUser,
      listMembers: [],
      _count: { tasks: 0 },
    } as any)
  })

  it('persists an explicit false', async () => {
    const res = await PUT(makePut({ name: 'Test List', showSubtasks: false }), {
      params: { id: 'list-123' },
    } as any)
    expect(res.status).toBe(200)
    expect(updateData().showSubtasks).toBe(false)
  })

  it('persists an explicit true', async () => {
    await PUT(makePut({ name: 'Test List', showSubtasks: true }), {
      params: { id: 'list-123' },
    } as any)
    expect(updateData().showSubtasks).toBe(true)
  })

  it('leaves the stored value alone when the key is absent', async () => {
    // The regression this guards: the web client round-trips the whole list
    // object on every settings save, so an omitted key must mean "unchanged",
    // never "reset to default".
    await PUT(makePut({ name: 'Renamed', color: '#ff0000' }), {
      params: { id: 'list-123' },
    } as any)
    expect(updateData()).not.toHaveProperty('showSubtasks')
  })

  it('ignores a non-boolean rather than coercing it', async () => {
    await PUT(makePut({ name: 'Test List', showSubtasks: 'false' }), {
      params: { id: 'list-123' },
    } as any)
    expect(updateData()).not.toHaveProperty('showSubtasks')
  })
})
