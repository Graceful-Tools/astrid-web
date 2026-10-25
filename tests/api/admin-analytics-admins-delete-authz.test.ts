/**
 * DELETE /api/admin/analytics/admins/:id — authorization (AWTD-1341).
 *
 * Runs the real lib/admin-auth against a mocked prisma. A non-admin is
 * refused; an admin cannot remove themselves. Because the caller must be an
 * admin and cannot remove themselves, the last admin can never be removed —
 * at least the caller always remains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const adminFindUnique = vi.hoisted(() => vi.fn())
const adminDelete = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminUser: { findUnique: adminFindUnique, delete: adminDelete },
    user: { findUnique: vi.fn() },
  },
}))

import { DELETE } from '@/app/api/admin/analytics/admins/[id]/route'

const ADMINS = new Set(['admin-1', 'admin-2'])

const del = (targetId: string) =>
  DELETE(new Request(`http://localhost/api/admin/analytics/admins/${targetId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id: targetId }),
  })
const signIn = (id: string | null) =>
  getUnifiedSession.mockResolvedValue(id ? { user: { id } } : null)

beforeEach(() => {
  vi.clearAllMocks()
  adminFindUnique.mockImplementation(async ({ where }) =>
    ADMINS.has(where.userId) ? { id: `row-${where.userId}`, userId: where.userId } : null,
  )
  adminDelete.mockResolvedValue({})
})

describe('DELETE /api/admin/analytics/admins/:id authorization (AWTD-1341)', () => {
  it('AWTD-1341: refuses a signed-out caller with 401', async () => {
    signIn(null)
    expect((await del('admin-2')).status).toBe(401)
    expect(adminDelete).not.toHaveBeenCalled()
  })

  it('AWTD-1341: refuses a non-admin with 403 and removes no one', async () => {
    signIn('user-1')
    expect((await del('admin-2')).status).toBe(403)
    expect(adminDelete).not.toHaveBeenCalled()
  })

  it('AWTD-1341: an admin cannot remove themselves (so the last admin can never be removed)', async () => {
    signIn('admin-1')
    const res = await del('admin-1')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/yourself/i)
    expect(adminDelete).not.toHaveBeenCalled()
  })

  it('AWTD-1341: an admin can remove another admin (control)', async () => {
    signIn('admin-1')
    const res = await del('admin-2')
    expect(res.status).toBe(200)
    expect(adminDelete).toHaveBeenCalledWith({ where: { userId: 'admin-2' } })
  })
})
