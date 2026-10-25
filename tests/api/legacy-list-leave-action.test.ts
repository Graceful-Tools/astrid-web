/**
 * PATCH /api/lists/:id/members { action: 'leave' } — spec §5.2 step 6.
 *
 * This was a third, hand-rolled implementation of leaving a list (beside
 * lib/list-leave.ts and lib/list-ownership-transfer.ts) and the only one that
 * announced nothing. It now delegates; these pin the delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'

const { leaveList, transferListOwnership } = vi.hoisted(() => ({
  leaveList: vi.fn(),
  transferListOwnership: vi.fn(),
}))
vi.mock('@/lib/list-leave', () => ({ leaveList }))
vi.mock('@/lib/list-ownership-transfer', () => ({ transferListOwnership }))

import { PATCH } from '@/app/api/lists/[id]/members/route'

const ctx = { params: Promise.resolve({ id: 'list-1' }) } as never
const leave = () => PATCH({ json: async () => ({ action: 'leave' }), headers: { get: () => null } } as never, ctx)

describe('legacy leave action uses the shared rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { id: 'me', email: 'me@example.com', name: 'Me' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    ;(mockPrisma as any).listMember.findMany = vi.fn()
    ;(mockPrisma as any).listInvite = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }
  })

  it('a member leaves through leaveList', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'someone-else' })
    leaveList.mockResolvedValue({ ok: true })

    const res = await leave()

    expect(res.status).toBe(200)
    expect(leaveList).toHaveBeenCalledWith({ listId: 'list-1', userId: 'me', userEmail: 'me@example.com' })
  })

  it("passes leaveList's refusal through", async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'someone-else' })
    leaveList.mockResolvedValue({ ok: false, status: 400, error: 'Cannot leave as the last admin.' })

    const res = await leave()

    expect(res.status).toBe(400)
  })

  it('an owner hands the list to the first admin through transferListOwnership', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'me' })
    ;(mockPrisma as any).listMember.findMany.mockResolvedValue([
      { userId: 'member-1', role: 'member' },
      { userId: 'admin-1', role: 'admin' },
    ])
    transferListOwnership.mockResolvedValue({ ok: true })

    const res = await leave()

    expect(res.status).toBe(200)
    expect(transferListOwnership).toHaveBeenCalledWith({ listId: 'list-1', currentUserId: 'me', newOwnerId: 'admin-1' })
    expect(leaveList).not.toHaveBeenCalled()
  })

  it('an owner with members but no admin is told to promote someone first', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ id: 'list-1', ownerId: 'me' })
    ;(mockPrisma as any).listMember.findMany.mockResolvedValue([{ userId: 'member-1', role: 'member' }])

    const res = await leave()

    expect(res.status).toBe(400)
    expect(transferListOwnership).not.toHaveBeenCalled()
  })
})
