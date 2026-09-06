/**
 * RED for the WebAuthn half of task 1a52195f.
 *
 * A WebAuthn challenge is single-use by definition, but both verify routes
 * deleted it only after a SUCCESSFUL verification. A failed or replayed
 * assertion left the challenge live for the rest of its five-minute TTL, so a
 * captured assertion could be replayed repeatedly inside that window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getChallenge = vi.hoisted(() => vi.fn())
const deleteChallenge = vi.hoisted(() => vi.fn())
const verifyAuthentication = vi.hoisted(() => vi.fn())

vi.mock('@/lib/webauthn', () => ({
  getChallenge,
  deleteChallenge,
  verifyAuthentication,
  isProduction: false,
}))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('next-auth/jwt', () => ({ encode: vi.fn().mockResolvedValue('jwt') }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { update: vi.fn() } } }))

function post(body: unknown) {
  return new NextRequest('http://localhost/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getChallenge.mockResolvedValue({ challenge: 'chal', userId: 'u1' })
  deleteChallenge.mockResolvedValue(undefined)
})

describe('webauthn authenticate/verify challenge lifetime', () => {
  it('burns the challenge even when verification FAILS', async () => {
    verifyAuthentication.mockResolvedValue({ verified: false, error: 'nope' })
    const { POST } = await import('@/app/api/auth/webauthn/authenticate/verify/route')

    const res = await POST(post({ sessionId: 's1', response: {} }))

    expect(res.status).toBe(401)
    expect(deleteChallenge).toHaveBeenCalledWith('s1')
  })

  it('burns the challenge before it is used to verify', async () => {
    const order: string[] = []
    deleteChallenge.mockImplementation(async () => { order.push('delete') })
    verifyAuthentication.mockImplementation(async () => {
      order.push('verify')
      return { verified: false, error: 'nope' }
    })
    const { POST } = await import('@/app/api/auth/webauthn/authenticate/verify/route')

    await POST(post({ sessionId: 's1', response: {} }))

    expect(order).toEqual(['delete', 'verify'])
  })
})
