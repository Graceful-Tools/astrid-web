/**
 * Regression for AWTD-1300: GitHub sign-in on a GitHub-App-backed brand (Lanes,
 * AWTD-1284) created the User and then failed at /api/auth/callback/github.
 *
 * A GitHub App with expiring user tokens answers the code exchange with
 * `refresh_token_expires_in` (and `expires_in`) on top of the columns `Account`
 * has. The adapter's `linkAccount` handed that whole object to
 * `prisma.account.create`, and Prisma rejects an unknown argument — so no
 * Account row, and every sign-in bounced to /api/auth/error. Astrid's classic
 * OAuth app never sends the field, which is why hosted Astrid never saw it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { authConfig } from '@/lib/auth-config'

const prismaWithAccount = mockPrisma as typeof mockPrisma & {
  account: Record<string, ReturnType<typeof vi.fn>>
}

/** What NextAuth passes for a GitHub App with token expiry on. */
const githubAppAccount = {
  userId: 'user-1',
  type: 'oauth',
  provider: 'github',
  providerAccountId: '12345',
  access_token: 'ghu_x',
  refresh_token: 'ghr_x',
  expires_at: 1792600000,
  expires_in: 28800,
  refresh_token_expires_in: 15811200,
  token_type: 'bearer',
  scope: '',
}

describe('linkAccount persists only Account columns (AWTD-1300)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaWithAccount.account = {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    }
  })

  it('drops refresh_token_expires_in and expires_in instead of failing the insert', async () => {
    await authConfig.adapter!.linkAccount!(githubAppAccount as any)

    const data = prismaWithAccount.account.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('refresh_token_expires_in')
    expect(data).not.toHaveProperty('expires_in')
    expect(data).toEqual({
      userId: 'user-1',
      type: 'oauth',
      provider: 'github',
      providerAccountId: '12345',
      access_token: 'ghu_x',
      refresh_token: 'ghr_x',
      expires_at: 1792600000,
      token_type: 'bearer',
      scope: '',
    })
  })

  it("keeps a classic OAuth app's account exactly as before", async () => {
    const classic = {
      userId: 'user-2', type: 'oauth', provider: 'google', providerAccountId: 'sub',
      access_token: 'at', expires_at: 1, token_type: 'Bearer', scope: 'openid', id_token: 'idt',
    }
    await authConfig.adapter!.linkAccount!(classic as any)
    expect(prismaWithAccount.account.create.mock.calls[0][0].data).toEqual(classic)
  })
})
