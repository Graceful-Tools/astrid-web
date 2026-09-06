/**
 * RED for task 1a52195f — the account pre-hijack.
 *
 * Passkey registration creates a User for any address with emailVerified left
 * null and no proof of ownership. Google and Apple sign-in then find accounts
 * BY EMAIL and link onto them. So an attacker registers a passkey on
 * victim@example.com; the victim later signs in with Google and lands in the
 * attacker's row, while the attacker's passkey keeps authenticating as them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'

const userUpdate = vi.fn()
const authenticatorDeleteMany = vi.fn()

const prisma = {
  user: { update: userUpdate },
  authenticator: { deleteMany: authenticatorDeleteMany },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  authenticatorDeleteMany.mockResolvedValue({ count: 1 })
  userUpdate.mockResolvedValue({})
})

describe('adoptUnverifiedAccount', () => {
  it('revokes the unproven passkeys when adopting an unverified account', async () => {
    const result = await adoptUnverifiedAccount(
      prisma,
      { id: 'victim-row', emailVerified: null },
      'google',
    )

    expect(result).toEqual({ adopted: true, revokedPasskeys: 1 })
    expect(authenticatorDeleteMany).toHaveBeenCalledWith({ where: { userId: 'victim-row' } })
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'victim-row' },
      data: { emailVerified: expect.any(Date) },
    })
  })

  it('leaves a already-verified account and its passkeys alone', async () => {
    const result = await adoptUnverifiedAccount(
      prisma,
      { id: 'real-user', emailVerified: new Date('2026-01-01') },
      'google',
    )

    expect(result).toEqual({ adopted: false, revokedPasskeys: 0 })
    expect(authenticatorDeleteMany).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })
})
