/**
 * AWTD-1112 (P3b): GitHub App user-to-server tokens, and the dual-read that
 * moves Issues sync onto them without breaking anyone.
 *
 * The App's user token reaches ONLY repos where the App is installed; the
 * legacy `repo`-scoped OAuth token reaches every repo the user can see. So the
 * App token is used for a repo exactly when one of the user's installations
 * reaches it, and the legacy token everywhere else — preferring the App token
 * blindly would 404 every uncovered repo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mockPrisma } from '../setup'
import { encryptField, decryptFieldStrict } from '@/lib/field-encryption'
import { githubTokenFor } from '@/lib/sync/github'
import { storeGithubAppUserToken } from '@/lib/github/user-tokens'

const USER = 'u-1'
const HOUR = 60 * 60 * 1000

function integration(provider: 'GITHUB' | 'GITHUB_ISSUES', token: string, extra: Record<string, unknown> = {}) {
  return {
    id: `int-${provider}`,
    userId: USER,
    provider,
    accessToken: encryptField(token),
    refreshToken: null,
    expiresAt: null,
    revokedAt: null,
    ...extra,
  }
}

function stubIntegrations(rows: ReturnType<typeof integration>[]) {
  mockPrisma.integration.findUnique.mockImplementation(async ({ where }: any) =>
    rows.find(r => r.provider === where.userId_provider.provider) ?? null,
  )
}

describe('githubTokenFor picks the token that can reach the repo (AWTD-1112)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
  })
  afterEach(() => vi.unstubAllGlobals())

  it("uses the App token for a repo one of the user's installations reaches", async () => {
    stubIntegrations([integration('GITHUB', 'ghu_app'), integration('GITHUB_ISSUES', 'gho_legacy')])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue({ repoId: BigInt(1) })

    expect(await githubTokenFor(USER, 'acme/api')).toBe('ghu_app')
    expect(mockPrisma.gitHubInstallationRepo.findFirst.mock.calls[0][0].where).toEqual({
      fullName: { equals: 'acme/api', mode: 'insensitive' },
      installation: { suspendedAt: null, access: { some: { userId: USER } } },
    })
  })

  it('keeps the legacy token for a repo no installation reaches', async () => {
    stubIntegrations([integration('GITHUB', 'ghu_app'), integration('GITHUB_ISSUES', 'gho_legacy')])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue(null)

    expect(await githubTokenFor(USER, 'someone/else')).toBe('gho_legacy')
  })

  it('is unchanged without a repo, or without an App token', async () => {
    stubIntegrations([integration('GITHUB_ISSUES', 'gho_legacy')])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue({ repoId: BigInt(1) })

    expect(await githubTokenFor(USER)).toBe('gho_legacy')
    expect(await githubTokenFor(USER, 'acme/api')).toBe('gho_legacy')
  })

  it('works for a user who only has the App token', async () => {
    stubIntegrations([integration('GITHUB', 'ghu_app')])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue({ repoId: BigInt(1) })

    expect(await githubTokenFor(USER, 'acme/api')).toBe('ghu_app')
  })

  it('refreshes an expired App token with its refresh token, and stores the new pair', async () => {
    stubIntegrations([
      integration('GITHUB', 'ghu_old', {
        refreshToken: encryptField('ghr_refresh'),
        expiresAt: new Date(Date.now() - HOUR),
      }),
    ])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue({ repoId: BigInt(1) })
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(await githubTokenFor(USER, 'acme/api')).toBe('ghu_new')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect(JSON.parse(String(init.body))).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'ghr_refresh',
      client_id: 'Iv23test',
    })
    const data = mockPrisma.integration.update.mock.calls[0][0].data
    expect(decryptFieldStrict(data.accessToken)).toBe('ghu_new')
    expect(decryptFieldStrict(data.refreshToken)).toBe('ghr_new')
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('falls back to the legacy token, never an installation token, when the refresh fails', async () => {
    stubIntegrations([
      integration('GITHUB', 'ghu_old', { refreshToken: encryptField('ghr_dead'), expiresAt: new Date(Date.now() - HOUR) }),
      integration('GITHUB_ISSUES', 'gho_legacy'),
    ])
    mockPrisma.gitHubInstallationRepo.findFirst.mockResolvedValue({ repoId: BigInt(1) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad_refresh_token' }), { status: 200 })))

    expect(await githubTokenFor(USER, 'acme/api')).toBe('gho_legacy')
  })
})

describe('storing the App user token (AWTD-1112)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('encrypts both tokens and records when the access token expires', async () => {
    await storeGithubAppUserToken(USER, {
      access_token: 'ghu_x',
      refresh_token: 'ghr_x',
      expires_in: 28800,
    })

    const call = mockPrisma.integration.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ userId_provider: { userId: USER, provider: 'GITHUB' } })
    expect(decryptFieldStrict(call.create.accessToken)).toBe('ghu_x')
    expect(decryptFieldStrict(call.create.refreshToken)).toBe('ghr_x')
    expect(call.create.expiresAt.getTime()).toBeGreaterThan(Date.now() + 7 * HOUR)
    expect(call.update.revokedAt).toBeNull()
  })
})

describe('RULE: a user token never falls back to an installation token (AWTD-1112, spec §7.2)', () => {
  it('lib/github/user-tokens.ts does not reach for the App or an installation', () => {
    const source = readFileSync(join(process.cwd(), 'lib/github/user-tokens.ts'), 'utf8')
    expect(source).not.toMatch(/getGitHubApp|getInstallationOctokit|installationId/)
  })
})
