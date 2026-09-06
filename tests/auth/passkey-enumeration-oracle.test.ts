/**
 * RED for task c2fbe8e4 — POST /api/auth/webauthn/register/options answered
 * { existingUser, email, hasPasskey } for an address that has an account and
 * { options, sessionId } for one that does not. Unauthenticated and (at the
 * time) unlimited, that is a free account-enumeration oracle: anyone could
 * test an email list against the user table and learn who has a passkey.
 *
 * The response must be indistinguishable for known and unknown emails. Whether
 * an account already exists is resolved at VERIFY time, which costs the caller
 * a real WebAuthn ceremony.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const findUnique = vi.hoisted(() => vi.fn())
const getRegistrationOptions = vi.hoisted(() => vi.fn())
const storeChallenge = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique } } }))
vi.mock('@/lib/webauthn', () => ({ getRegistrationOptions, storeChallenge }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))

function post(body: unknown) {
  return new NextRequest('http://localhost/api/auth/webauthn/register/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue(null)
  getRegistrationOptions.mockResolvedValue({ challenge: 'chal', rp: { id: 'localhost' } })
  storeChallenge.mockResolvedValue(undefined)
})

describe('register/options is not an enumeration oracle (task c2fbe8e4)', () => {
  it('answers with the same status and the same keys for a known and an unknown email', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    findUnique.mockResolvedValue({ id: 'u1', email: 'known@example.com', authenticators: [{ id: 'a1' }] })
    const knownRes = await POST(post({ email: 'known@example.com' }))
    const known = await knownRes.json()

    findUnique.mockResolvedValue(null)
    const unknownRes = await POST(post({ email: 'unknown@example.com' }))
    const unknown = await unknownRes.json()

    expect(knownRes.status).toBe(unknownRes.status)
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort())
  })

  it('never reveals account existence or passkey ownership in the body', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    findUnique.mockResolvedValue({ id: 'u1', email: 'known@example.com', authenticators: [{ id: 'a1' }] })
    const res = await POST(post({ email: 'known@example.com' }))
    const body = await res.json()

    expect(body).not.toHaveProperty('existingUser')
    expect(body).not.toHaveProperty('hasPasskey')
    expect(JSON.stringify(body)).not.toMatch(/existingUser|hasPasskey/)
  })

  it('still issues a usable registration challenge for a brand new email', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    findUnique.mockResolvedValue(null)
    const res = await POST(post({ email: 'new@example.com' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.options).toBeTruthy()
    expect(body.sessionId).toBeTruthy()
    expect(storeChallenge).toHaveBeenCalled()
  })
})
