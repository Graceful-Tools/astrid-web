/**
 * ADEV-104 — anyone who reached a self-hosted instance could create a passkey
 * account for any address. REGISTRATION_ALLOWED_EMAIL_DOMAINS (comma-separated
 * domains or full addresses) closes sign-up to the listed ones. Unset keeps
 * registration open, which is astrid.cc.
 *
 * Existing accounts are untouched: signing in, and adding a passkey from inside
 * a session, never consult the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const findUnique = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const getRegistrationOptions = vi.hoisted(() => vi.fn())
const storeChallenge = vi.hoisted(() => vi.fn())
const getChallenge = vi.hoisted(() => vi.fn())
const deleteChallenge = vi.hoisted(() => vi.fn())
const verifyRegistrationCredential = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique, create } } }))
vi.mock('@/lib/webauthn', () => ({
  getRegistrationOptions,
  storeChallenge,
  getChallenge,
  deleteChallenge,
  verifyRegistrationCredential,
  verifyRegistration: vi.fn(),
  persistRegisteredCredential: vi.fn(),
}))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/default-lists', () => ({ createDefaultListsForUser: vi.fn() }))
vi.mock('@/lib/email-verification', () => ({ sendEmailVerification: vi.fn() }))
vi.mock('@/lib/system-tasks', () => ({ createVerifyEmailTask: vi.fn() }))

import {
  isRegistrationAllowed,
  REGISTRATION_NOT_ALLOWED,
} from '@/lib/auth/registration-allowlist'

const ip = () => `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() },
    body: JSON.stringify(body),
  })
}

const ENV = ['REGISTRATION_ALLOWED_EMAIL_DOMAINS', 'INITIAL_ADMIN_EMAIL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const name of ENV) { saved[name] = process.env[name]; delete process.env[name] }
  getUnifiedSession.mockResolvedValue(null)
  getRegistrationOptions.mockResolvedValue({ challenge: 'chal', rp: { id: 'localhost' } })
  storeChallenge.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('isRegistrationAllowed (ADEV-104)', () => {
  it('ADEV-104: allows any address when the allowlist is unset', () => {
    expect(isRegistrationAllowed('anyone@anywhere.test')).toBe(true)
  })

  it('ADEV-104: matches listed domains and full addresses, case-insensitively', () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = ' Acme.example , contractor@elsewhere.test '
    expect(isRegistrationAllowed('jane@ACME.example')).toBe(true)
    expect(isRegistrationAllowed('Contractor@elsewhere.test')).toBe(true)
    expect(isRegistrationAllowed('other@elsewhere.test')).toBe(false)
    expect(isRegistrationAllowed('jane@evil-acme.example')).toBe(false)
    expect(isRegistrationAllowed('jane@sub.acme.example')).toBe(false)
  })

  it('ADEV-104: always allows the configured bootstrap admin', () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
    process.env.INITIAL_ADMIN_EMAIL = 'ops@hosting.test'
    expect(isRegistrationAllowed('ops@hosting.test')).toBe(true)
  })
})

describe('POST /api/auth/webauthn/register/options (ADEV-104)', () => {
  it('ADEV-104: refuses a sign-up email outside the allowlist with a stable code', async () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    const res = await POST(post('/api/auth/webauthn/register/options', { email: 'mallory@outside.test' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe(REGISTRATION_NOT_ALLOWED)
    expect(body.error).toBeTruthy()
    expect(storeChallenge).not.toHaveBeenCalled()
  })

  it('ADEV-104: issues a challenge for an allowlisted sign-up email', async () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    const res = await POST(post('/api/auth/webauthn/register/options', { email: 'jane@acme.example' }))

    expect(res.status).toBe(200)
    expect(storeChallenge).toHaveBeenCalled()
  })

  it('ADEV-104: still lets a signed-in user outside the allowlist add a passkey', async () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
    getUnifiedSession.mockResolvedValue({ user: { id: 'u1', email: 'old@outside.test' } })
    const { POST } = await import('@/app/api/auth/webauthn/register/options/route')

    const res = await POST(post('/api/auth/webauthn/register/options', {}))

    expect(res.status).toBe(200)
    expect(storeChallenge).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'u1' }))
  })
})

describe('POST /api/auth/webauthn/register/verify (ADEV-104)', () => {
  it('ADEV-104: never creates an account outside the allowlist, even from a challenge issued before it was set', async () => {
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
    getChallenge.mockResolvedValue({ challenge: 'chal', email: 'mallory@outside.test' })
    verifyRegistrationCredential.mockResolvedValue({ verified: true, registrationInfo: {} })
    findUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/auth/webauthn/register/verify/route')

    const res = await POST(post('/api/auth/webauthn/register/verify', { sessionId: 's1', response: { id: 'cred' } }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe(REGISTRATION_NOT_ALLOWED)
    expect(create).not.toHaveBeenCalled()
  })
})
