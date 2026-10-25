/**
 * Regression for AWTD-1088 (task 2167a6f9): web Google sign-in linked onto an
 * existing account by email without checking Google's `email_verified` and
 * without adopting the account, then marked the email verified.
 *
 * That reopened, on web, the passkey pre-hijack task 1a52195f closed on
 * mobile: register a passkey for victim@x (unverified), wait for the victim to
 * sign in with Google, keep authenticating with the passkey. The mobile routes
 * require `email_verified` and call `adoptUnverifiedAccount`; the web callback
 * must do the same.
 *
 * Also pinned: the adapter's `linkAccount` must never move an existing
 * (provider, providerAccountId) identity onto a different user.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { authConfig } from '@/lib/auth-config'

const prismaWithAuthTables = mockPrisma as typeof mockPrisma & {
  account: Record<string, ReturnType<typeof vi.fn>>
  authenticator: Record<string, ReturnType<typeof vi.fn>>
}

const googleAccount = {
  provider: 'google',
  type: 'oauth',
  providerAccountId: 'google-sub-123',
  access_token: 'at',
}

function signIn(profile: Record<string, unknown>, email = 'victim@example.com') {
  return authConfig.callbacks!.signIn!({
    user: { id: 'nextauth-temp', email, name: 'Victim' },
    account: googleAccount as any,
    profile: profile as any,
  } as any)
}

describe('web Google sign-in links only on a verified email, and adopts (AWTD-1088)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAuthTables.account = {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    }
    prismaWithAuthTables.authenticator = {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    }
  })

  it('refuses to link when Google does not affirm the email is verified', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'victim-row', email: 'victim@example.com', emailVerified: new Date(), accounts: [],
    })

    const result = await signIn({ email: 'victim@example.com', email_verified: false })

    expect(result).toBe(false)
    expect(prismaWithAuthTables.account.create).not.toHaveBeenCalled()
  })

  it('refuses when the claim is missing entirely', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'victim-row', email: 'victim@example.com', emailVerified: new Date(), accounts: [],
    })

    const result = await signIn({ email: 'victim@example.com' })

    expect(result).toBe(false)
    expect(prismaWithAuthTables.account.create).not.toHaveBeenCalled()
  })

  it('revokes passkeys registered on an unverified account before linking Google to it', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'prehijacked-row', email: 'victim@example.com', emailVerified: null, accounts: [],
    })

    const result = await signIn({ email: 'victim@example.com', email_verified: true, name: 'Victim' })

    expect(result).toBe(true)
    expect(prismaWithAuthTables.authenticator.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'prehijacked-row' },
    })
    expect(prismaWithAuthTables.account.create).toHaveBeenCalledTimes(1)
  })

  it('leaves a verified account’s passkeys alone', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'verified-row', email: 'victim@example.com', emailVerified: new Date('2025-01-01'), accounts: [],
    })

    const result = await signIn({ email: 'victim@example.com', email_verified: true })

    expect(result).toBe(true)
    expect(prismaWithAuthTables.authenticator.deleteMany).not.toHaveBeenCalled()
  })

  it('never stamps emailVerified on a profile refresh — only adoption may verify', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'verified-row', email: 'victim@example.com', emailVerified: new Date('2025-01-01'), accounts: [],
    })

    await signIn({ email: 'victim@example.com', email_verified: true, picture: 'https://img/p.png' })

    for (const [args] of mockPrisma.user.update.mock.calls) {
      expect((args as any).data).not.toHaveProperty('emailVerified')
    }
  })
})

describe('linkAccount never re-homes an identity (AWTD-1088)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAuthTables.account = {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    }
  })

  it('refuses to move an existing provider identity to another user', async () => {
    prismaWithAuthTables.account.findUnique.mockResolvedValue({
      id: 'acc-1', userId: 'original-owner', provider: 'google', providerAccountId: 'google-sub-123',
    })

    await expect(
      authConfig.adapter!.linkAccount!({ ...googleAccount, userId: 'someone-else' } as any),
    ).rejects.toThrow()
    expect(prismaWithAuthTables.account.update).not.toHaveBeenCalled()
  })

  it('is a no-op when the identity already belongs to this user', async () => {
    prismaWithAuthTables.account.findUnique.mockResolvedValue({
      id: 'acc-1', userId: 'same-user', provider: 'google', providerAccountId: 'google-sub-123',
    })

    await authConfig.adapter!.linkAccount!({ ...googleAccount, userId: 'same-user' } as any)

    expect(prismaWithAuthTables.account.update).not.toHaveBeenCalled()
    expect(prismaWithAuthTables.account.create).not.toHaveBeenCalled()
  })
})

describe('a user created by the OAuth flow starts verified (AWTD-1088)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps emailVerified on creation, so the next sign-in does not treat them as a pre-hijack', async () => {
    // The only NextAuth provider is Google, and signIn refuses an unverified
    // Google email before the adapter runs — so a row created here is proven.
    // Left null, the user's second sign-in would "adopt" their own account and
    // revoke the passkeys they had registered in between.
    mockPrisma.user.findUnique.mockResolvedValue(null)
    mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'new-row', ...data }))

    await authConfig.adapter!.createUser!({ email: 'New@Example.com', name: 'New', emailVerified: null } as any)

    const data = mockPrisma.user.create.mock.calls[0][0].data
    expect(data.email).toBe('new@example.com')
    expect(data.emailVerified).toBeInstanceOf(Date)
  })
})
