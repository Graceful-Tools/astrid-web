/**
 * ADEV-104 — REGISTRATION_ALLOWED_EMAIL_DOMAINS also closes the federated
 * route to a NEW account: Google, Apple, GitHub and SSO sign-in create users
 * too. An identity already linked, or an existing account with that email,
 * still signs in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockPrisma } from '../setup'

const prismaWithAuth = mockPrisma as typeof mockPrisma & {
  account: Record<string, ReturnType<typeof vi.fn>>
  authenticator: Record<string, ReturnType<typeof vi.fn>>
}

vi.mock('@/lib/default-lists', () => ({ createDefaultListsForUser: vi.fn() }))

import { linkFederatedIdentity, signInWithVerifiedIdentity } from '@/lib/auth/federated-identity-linking'

const google = (email: string) => ({
  provider: 'google',
  account: { provider: 'google', type: 'oauth', providerAccountId: 'g-1' },
  email,
  emailTrust: 'verified' as const,
  profile: { name: 'Someone' },
})

describe('federated sign-in honours the registration allowlist (ADEV-104)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAuth.account = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    }
    prismaWithAuth.authenticator = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }
    mockPrisma.user.findUnique.mockResolvedValue(null)
    delete process.env.INITIAL_ADMIN_EMAIL
    process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS = 'acme.example'
  })

  afterEach(() => {
    delete process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS
  })

  it('ADEV-104: refuses to create a new user outside the allowlist', async () => {
    await expect(linkFederatedIdentity(google('mallory@outside.test'))).resolves.toBe(false)
    await expect(signInWithVerifiedIdentity(google('mallory@outside.test'))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('ADEV-104: lets a new allowlisted user through', async () => {
    await expect(linkFederatedIdentity(google('jane@acme.example'))).resolves.toBe(true)
  })

  it('ADEV-104: still links onto an existing account outside the allowlist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'old@outside.test', emailVerified: new Date(), isAIAgent: false })
    await expect(linkFederatedIdentity(google('old@outside.test'))).resolves.toBe(true)
  })

  it('ADEV-104: still signs in an identity already linked', async () => {
    prismaWithAuth.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })
    await expect(linkFederatedIdentity(google('old@outside.test'))).resolves.toBe(true)
  })
})
