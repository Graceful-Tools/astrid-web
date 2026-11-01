/**
 * /api/admin/encryption-rotation — the production-side re-encryption pass
 * (AWTD-1369).
 *
 * Production's keys are write-only Vercel Secrets, so the rewrite can only run
 * inside production. It rewrites users' secrets, so: admin only, GET is a dry
 * run that writes nothing, and only POST rewrites — and only once a rotation
 * is actually configured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const adminFindUnique = vi.hoisted(() => vi.fn())
const reencrypt = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', async () => {
  const { UnauthorizedError } = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware',
  )
  return { authenticateAPI, UnauthorizedError }
})
vi.mock('@/lib/prisma', () => ({ prisma: { adminUser: { findUnique: adminFindUnique } } }))
vi.mock('@/lib/reencrypt-runner', () => ({ reencrypt }))

import { GET, POST } from '@/app/api/admin/encryption-rotation/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const OLD = 'a'.repeat(64)
const NEW = 'b'.repeat(64)
const url = 'http://localhost/api/admin/encryption-rotation'
const get = () => GET(new NextRequest(url))
const post = () => POST(new NextRequest(url, { method: 'POST' }))

const savedEnv = { key: process.env.ENCRYPTION_KEY, next: process.env.ENCRYPTION_KEY_NEXT }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ENCRYPTION_KEY = OLD
  process.env.ENCRYPTION_KEY_NEXT = NEW
  adminFindUnique.mockImplementation(async ({ where }) =>
    where.userId === 'admin-1' ? { id: 'row', userId: 'admin-1' } : null,
  )
  reencrypt.mockImplementation(async (_db, _options, reporter) => {
    reporter.table('AddressBookContact', { rewritten: 2, skipped: 0, failed: 1, conflicts: 0 })
    reporter.problem('AddressBookContact.name id=c1 no key decrypts it')
    return { rewritten: 2, skipped: 0, failed: 1, conflicts: 0 }
  })
})

afterEach(() => {
  process.env.ENCRYPTION_KEY = savedEnv.key
  if (savedEnv.next === undefined) delete process.env.ENCRYPTION_KEY_NEXT
  else process.env.ENCRYPTION_KEY_NEXT = savedEnv.next
})

describe('/api/admin/encryption-rotation (AWTD-1369)', () => {
  it('AWTD-1369: refuses an unauthenticated caller with 401 on GET and POST, touching nothing', async () => {
    authenticateAPI.mockRejectedValue(new UnauthorizedError('No valid authentication found'))
    expect((await get()).status).toBe(401)
    expect((await post()).status).toBe(401)
    expect(reencrypt).not.toHaveBeenCalled()
  })

  it('AWTD-1369: refuses a non-admin with 403 on GET and POST, touching nothing', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'user-1' })
    expect((await get()).status).toBe(403)
    expect((await post()).status).toBe(403)
    expect(reencrypt).not.toHaveBeenCalled()
  })

  it('AWTD-1369: GET is a dry run — counts, problems by location, uncached', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(reencrypt).toHaveBeenCalledTimes(1)
    expect(reencrypt.mock.calls[0][1]).toMatchObject({ dryRun: true, verify: false })
    const body = await res.json()
    expect(body.mode).toBe('dry-run')
    expect(body.ring).toEqual({ keys: 2, rotationInProgress: true })
    expect(body.totals).toEqual({ rewritten: 2, skipped: 0, failed: 1, conflicts: 0 })
    expect(body.tables).toEqual([
      { table: 'AddressBookContact', rewritten: 2, skipped: 0, failed: 1, conflicts: 0 },
    ])
    expect(body.problems).toEqual(['AddressBookContact.name id=c1 no key decrypts it'])
  })

  it('AWTD-1369: POST rewrites', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(reencrypt.mock.calls[0][1]).toMatchObject({ dryRun: false, verify: false })
    expect((await res.json()).mode).toBe('rewrite')
  })

  it('AWTD-1369: POST refuses with 409 when no rotation is configured, and writes nothing', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    delete process.env.ENCRYPTION_KEY_NEXT
    const res = await post()
    expect(res.status).toBe(409)
    expect(reencrypt).not.toHaveBeenCalled()
  })

  it('AWTD-1369: refuses with 409 when NEXT equals the current key, without echoing either', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    process.env.ENCRYPTION_KEY_NEXT = OLD
    for (const res of [await get(), await post()]) {
      expect(res.status).toBe(409)
      expect(await res.text()).not.toContain(OLD)
    }
    expect(reencrypt).not.toHaveBeenCalled()
  })

  it('AWTD-1369: caps the problem list so a wholly unreadable table cannot flood the response', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1' })
    reencrypt.mockImplementation(async (_db, _options, reporter) => {
      for (let i = 0; i < 500; i++) reporter.problem(`AddressBookContact.name id=c${i} no key decrypts it`)
      return { rewritten: 0, skipped: 0, failed: 500, conflicts: 0 }
    })
    const body = await (await get()).json()
    expect(body.problems).toHaveLength(50)
    expect(body.problemsTruncated).toBe(450)
  })
})
