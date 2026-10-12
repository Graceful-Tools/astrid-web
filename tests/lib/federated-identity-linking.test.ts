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

const createDefaultListsForUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/default-lists', () => ({ createDefaultListsForUser }))

import { linkFederatedIdentity, signInWithVerifiedIdentity } from '@/lib/auth/federated-identity-linking'

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

/**
 * AWTD-1104 — the native (iOS) sign-in routes create the user themselves, so
 * they need the rule AND the creation, in one call. Before this each of the
 * four routes carried its own copy, and Google's never looked the identity up
 * by its Google account id: it went straight to the email.
 */
describe('signInWithVerifiedIdentity (AWTD-1104)', () => {
  const google = (over: Record<string, unknown> = {}) => ({
    provider: 'google',
    account: { provider: 'google', type: 'oauth', providerAccountId: 'g-sub-1', id_token: 'idt' },
    email: 'dev@example.com' as string | null,
    emailTrust: 'verified' as const,
    profile: { name: 'Dev', image: 'https://img/dev.png' },
    ...over,
  })

  const u1 = { id: 'u1', email: 'dev@example.com', name: 'Dev', image: null, emailVerified: new Date(), isAIAgent: false }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAuth.account = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    }
    prismaWithAuth.authenticator = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }
    mockPrisma.user.findUnique.mockResolvedValue(null)
    mockPrisma.user.update.mockImplementation(async ({ where, data }: any) => ({ ...u1, id: where.id, ...data }))
    mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'new-user', isAIAgent: false, ...data }))
    delete process.env.INITIAL_ADMIN_EMAIL
  })

  it('AWTD-1104: finds the user by provider account id before looking at the email', async () => {
    prismaWithAuth.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })
    // The email now belongs to somebody else; the identity is still u1's.
    mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'u1' ? u1 : { ...u1, id: 'someone-else' },
    )

    const result = await signInWithVerifiedIdentity(google())

    expect(result).toMatchObject({ ok: true, created: false, linked: false, user: { id: 'u1' } })
    expect(prismaWithAuth.account.create).not.toHaveBeenCalled()
  })

  it('AWTD-1104: signs a known identity in without an email — Apple sends it only the first time', async () => {
    prismaWithAuth.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })
    mockPrisma.user.findUnique.mockResolvedValue(u1)

    const result = await signInWithVerifiedIdentity(google({ email: null, emailTrust: 'none' }))

    expect(result).toMatchObject({ ok: true, user: { id: 'u1' } })
  })

  it('AWTD-1104: fills a missing name on a returning user, never overwrites one', async () => {
    prismaWithAuth.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })
    mockPrisma.user.findUnique.mockResolvedValue({ ...u1, name: null })

    await signInWithVerifiedIdentity(google({ profile: { name: 'Apple Name' } }))
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { name: 'Apple Name' } })

    mockPrisma.user.update.mockClear()
    mockPrisma.user.findUnique.mockResolvedValue(u1)
    await signInWithVerifiedIdentity(google({ profile: { name: 'Apple Name' } }))
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('AWTD-1104: refuses an unknown identity with no email', async () => {
    await expect(signInWithVerifiedIdentity(google({ email: null }))).resolves.toEqual({ ok: false, reason: 'missing-email' })
  })

  it('AWTD-1104: refuses an unknown identity whose email the provider did not verify', async () => {
    await expect(signInWithVerifiedIdentity(google({ emailTrust: 'none' }))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('AWTD-1104: links onto the existing account by verified email, adopting it first', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...u1, emailVerified: null })

    const result = await signInWithVerifiedIdentity(google())

    expect(result).toMatchObject({ ok: true, created: false, linked: true, user: { id: 'u1' } })
    expect(prismaWithAuth.authenticator.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(prismaWithAuth.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', provider: 'google', providerAccountId: 'g-sub-1', id_token: 'idt' }),
    })
  })

  it('AWTD-1104: creates a verified user with the identity and default lists', async () => {
    const result = await signInWithVerifiedIdentity(google({ email: 'New@Example.com' }))

    expect(result).toMatchObject({ ok: true, created: true, linked: false, user: { id: 'new-user' } })
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'new@example.com',
        name: 'Dev',
        image: 'https://img/dev.png',
        emailVerified: expect.any(Date),
        accounts: { create: expect.objectContaining({ provider: 'google', providerAccountId: 'g-sub-1', id_token: 'idt' }) },
      }),
    })
    expect(createDefaultListsForUser).toHaveBeenCalledWith('new-user')
  })

  it('AWTD-1104: names a new user after the email when the provider gives no name', async () => {
    await signInWithVerifiedIdentity(google({ profile: {} }))
    expect(mockPrisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'dev' }) })
  })

  it('AWTD-1104: never links onto the initial admin, as on web', async () => {
    process.env.INITIAL_ADMIN_EMAIL = 'dev@example.com'
    mockPrisma.user.findUnique.mockResolvedValue(u1)
    await expect(signInWithVerifiedIdentity(google())).resolves.toEqual({ ok: false, reason: 'refused' })
  })
})
