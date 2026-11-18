/**
 * ADEV-104 — on a fresh instance the first admin waited for the 08:00 UTC
 * analytics cron, the only caller of ensureInitialAdmin(). The grant needs a
 * verified email, and verifying the email is the moment that becomes true, so
 * the verification handler applies the grant itself (same function; the cron
 * stays as a backstop).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const ensureInitialAdmin = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst, update, findUnique: vi.fn() } } }))
vi.mock('@/lib/email', () => ({ sendVerificationEmail: vi.fn() }))
vi.mock('@/lib/system-tasks', () => ({ completeVerifyEmailTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/admin-auth', () => ({ ensureInitialAdmin }))

import { verifyEmailToken } from '@/lib/email-verification'

const pendingUser = {
  id: 'user-1',
  email: 'owner@example.com',
  pendingEmail: null,
  emailVerificationToken: 'tok',
  emailTokenExpiresAt: new Date(Date.now() + 60_000),
}

describe('verifyEmailToken applies the initial admin grant (ADEV-104)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureInitialAdmin.mockResolvedValue(undefined)
    update.mockResolvedValue(pendingUser)
  })

  it('ADEV-104: runs ensureInitialAdmin once the email is marked verified', async () => {
    findFirst.mockResolvedValue(pendingUser)

    const result = await verifyEmailToken('tok')

    expect(result.success).toBe(true)
    expect(ensureInitialAdmin).toHaveBeenCalledTimes(1)
    // After the write that makes the address verified, or the grant refuses.
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(ensureInitialAdmin.mock.invocationCallOrder[0])
  })

  it('ADEV-104: does not run it for an invalid or expired token', async () => {
    findFirst.mockResolvedValue(null)

    const result = await verifyEmailToken('nope')

    expect(result.success).toBe(false)
    expect(ensureInitialAdmin).not.toHaveBeenCalled()
  })

  it('ADEV-104: a failed grant does not fail the verification (the cron retries it)', async () => {
    findFirst.mockResolvedValue(pendingUser)
    ensureInitialAdmin.mockRejectedValue(new Error('db blip'))

    const result = await verifyEmailToken('tok')

    expect(result.success).toBe(true)
  })
})
