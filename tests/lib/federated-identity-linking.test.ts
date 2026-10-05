/**
 * P2 (spec §6.3) — the linking rules every federated sign-in shares.
 *
 * Linking a new provider identity onto an existing account by email is the
 * account-takeover surface, and every provider added makes it larger. So the
 * rule is one function, and a sign-in that does not meet it is refused outright
 * — which is also what lets the adapter start every OAuth-created user verified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma } from '../setup'
import { BRAND } from '@/lib/brand/config'

const prismaWithAuth = mockPrisma as typeof mockPrisma & {
  account: Record<string, ReturnType<typeof vi.fn>>
  authenticator: Record<string, ReturnType<typeof vi.fn>>
}

import { linkFederatedIdentity } from '@/lib/auth/federated-identity-linking'

const github = (over: Record<string, unknown> = {}) => ({
  provider: 'github',
  account: { provider: 'github', type: 'oauth', providerAccountId: '583231' },
  email: 'dev@example.com',
  emailTrust: 'verified' as const,
  profile: { name: 'Dev' },
  ...over,
})

describe('linkFederatedIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAuth.account = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    }
    prismaWithAuth.authenticator = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }
    mockPrisma.user.findUnique.mockResolvedValue(null)
    delete process.env.INITIAL_ADMIN_EMAIL
  })

  it('signs in an identity it already knows, without linking anything', async () => {
    prismaWithAuth.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })

    await expect(linkFederatedIdentity(github())).resolves.toBe(true)
    expect(prismaWithAuth.account.create).not.toHaveBeenCalled()
  })

  it('refuses an email the provider did not verify — even for a brand-new user', async () => {
    await expect(linkFederatedIdentity(github({ emailTrust: 'none' }))).resolves.toBe(false)
  })

  it('links a verified email onto the existing account, adopting it first', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'dev@example.com', emailVerified: null, isAIAgent: false })

    await expect(linkFederatedIdentity(github())).resolves.toBe(true)
    // adoptUnverifiedAccount: the passkey pre-hijack does not survive (1a52195f).
    expect(prismaWithAuth.authenticator.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(prismaWithAuth.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', provider: 'github', providerAccountId: '583231' }),
    })
  })

  it('lets a brand-new verified identity through to be created', async () => {
    await expect(linkFederatedIdentity(github())).resolves.toBe(true)
    expect(prismaWithAuth.account.create).not.toHaveBeenCalled()
  })

  describe('domain-bound (SSO) identities', () => {
    const sso = (email: string) => ({
      provider: 'sso',
      account: { provider: 'sso', type: 'oauth', providerAccountId: 'sub-1' },
      email,
      emailTrust: 'domain-bound' as const,
      allowedDomains: ['acme.example'],
      profile: {},
    })

    it('accepts an email in the connection’s domains', async () => {
      await expect(linkFederatedIdentity(sso('pat@acme.example'))).resolves.toBe(true)
    })

    it('refuses an email outside them — an IdP can assert any address', async () => {
      await expect(linkFederatedIdentity(sso('victim@gmail.com'))).resolves.toBe(false)
    })

    it('refuses a look-alike domain', async () => {
      await expect(linkFederatedIdentity(sso('pat@evil-acme.example'))).resolves.toBe(false)
    })

    it('never links onto an AI agent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'agent', email: 'pat@acme.example', isAIAgent: true, emailVerified: new Date() })
      await expect(linkFederatedIdentity(sso('pat@acme.example'))).resolves.toBe(false)
    })

    it('never links onto an agent address, whatever the domain list says', async () => {
      const agentEmail = `claude@${BRAND.agentEmailDomain}`
      await expect(
        linkFederatedIdentity({ ...sso(agentEmail), allowedDomains: [BRAND.agentEmailDomain] }),
      ).resolves.toBe(false)
    })

    it('never links onto the initial admin', async () => {
      process.env.INITIAL_ADMIN_EMAIL = 'boss@acme.example'
      await expect(linkFederatedIdentity(sso('boss@acme.example'))).resolves.toBe(false)
    })
  })
})
