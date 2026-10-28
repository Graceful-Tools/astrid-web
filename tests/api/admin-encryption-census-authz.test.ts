/**
 * GET /api/admin/encryption-census — authorization (AWTD-1369).
 *
 * The census reads every encrypted column in production. Its output is counts
 * only, but it is still admin-only: a signed-out caller gets 401, a non-admin
 * 403, and neither causes a single row to be read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const adminFindUnique = vi.hoisted(() => vi.fn())
const runEncryptionCensus = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', async () => {
  const { UnauthorizedError } = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware',
  )
  return { authenticateAPI, UnauthorizedError }
})
vi.mock('@/lib/prisma', () => ({ prisma: { adminUser: { findUnique: adminFindUnique } } }))
vi.mock('@/lib/encryption-census', () => ({ runEncryptionCensus }))

import { GET } from '@/app/api/admin/encryption-census/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const get = () => GET(new NextRequest('http://localhost/api/admin/encryption-census'))

beforeEach(() => {
  vi.clearAllMocks()
  adminFindUnique.mockImplementation(async ({ where }) =>
    where.userId === 'admin-1' ? { id: 'row', userId: 'admin-1' } : null,
  )
  runEncryptionCensus.mockResolvedValue({ ring: {}, columns: [], totals: {} })
})

describe('GET /api/admin/encryption-census authorization (AWTD-1369)', () => {
  it('AWTD-1369: refuses an unauthenticated caller with 401 and reads nothing', async () => {
    authenticateAPI.mockRejectedValue(new UnauthorizedError('No valid authentication found'))
    expect((await get()).status).toBe(401)
    expect(runEncryptionCensus).not.toHaveBeenCalled()
  })

  it('AWTD-1369: refuses a non-admin with 403 and reads nothing', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'user-1' })
    expect((await get()).status).toBe(403)
    expect(runEncryptionCensus).not.toHaveBeenCalled()
  })

  it('AWTD-1369: runs the census for an admin, uncached', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(runEncryptionCensus).toHaveBeenCalledTimes(1)
  })
})
