/**
 * Regression for AWTD-1111 (P3a, also AWTD-1107): the coding agent acted on a
 * repo through the WRONG GitHub App installation.
 *
 * `GitHubClient.forUser` read only the user's FIRST `GitHubIntegration` row and
 * its cached repo list. A repo in the user's second org was not in that list,
 * so `getInstallationIdForRepo` fell back to the first org's installation —
 * whose token cannot see the repo — and every call 404'd. Repos added by the
 * `installation_repositories` webhook were cached without an installation id,
 * with the same result.
 *
 * The rule these tests pin: the installation for a repo comes from
 * GitHubInstallationRepo, across EVERY installation the user has access to.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { unknownWhereFields } from '../utils/prisma-where'

const getInstallationOctokit = vi.fn()

vi.mock('@/lib/github/app', () => ({
  getGitHubApp: () => ({ getInstallationOctokit }),
}))

import { GitHubClient } from '@/lib/github-client'

const USER = 'user-1'
const ACME = 111
const BETA = 222

function octokitFor(installationId: number) {
  return {
    installationId,
    request: vi.fn(async (_route: string, params: { owner: string; repo: string }) => ({
      data: {
        id: 1,
        name: params.repo,
        full_name: `${params.owner}/${params.repo}`,
        default_branch: 'main',
        private: true,
        html_url: '',
        clone_url: '',
      },
    })),
  }
}

function repoRow(repoId: number, installationId: number, fullName: string) {
  return { repoId: BigInt(repoId), installationId, fullName, defaultBranch: 'main', private: true, nodeId: null }
}

describe('GitHubClient picks the installation that owns the repo (AWTD-1111)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getInstallationOctokit.mockImplementation(async (id: number) => octokitFor(id))

    // Legacy row: the FIRST integration only knows acme's repos.
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      {
        id: 'gi-1',
        userId: USER,
        installationId: ACME,
        repositories: [{ id: 1, name: 'api', fullName: 'acme/api', installationId: ACME, owner: 'acme' }],
      },
    ])
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([
      { installation: { id: ACME, accountLogin: 'acme' } },
      { installation: { id: BETA, accountLogin: 'beta' } },
    ])
    mockPrisma.gitHubInstallationRepo.findMany.mockResolvedValue([
      repoRow(1, ACME, 'acme/api'),
      repoRow(2, BETA, 'beta/web'),
    ])
  })

  it("uses the second org's installation for a repo in the second org", async () => {
    const client = await GitHubClient.forUser(USER)
    await client.getRepository('beta/web')

    expect(getInstallationOctokit).toHaveBeenLastCalledWith(BETA)
  })

  it('matches an unlisted repo to the installation on its owner account, not the first one', async () => {
    const client = await GitHubClient.forUser(USER)
    await client.getRepository('beta/brand-new-repo')

    expect(getInstallationOctokit).toHaveBeenLastCalledWith(BETA)
  })

  it('only reads repos from installations the user has access to, and not suspended ones', async () => {
    await GitHubClient.forUser(USER)

    const where = mockPrisma.gitHubInstallationRepo.findMany.mock.calls[0][0].where
    expect(unknownWhereFields('GitHubInstallationRepo', where)).toEqual([])
    expect(where).toEqual({ installation: { suspendedAt: null, access: { some: { userId: USER } } } })
  })

  it('still works for a user whose links have not been moved to the new tables', async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([])
    mockPrisma.gitHubInstallationRepo.findMany.mockResolvedValue([])

    const client = await GitHubClient.forUser(USER)
    await client.getRepository('acme/api')

    expect(getInstallationOctokit).toHaveBeenLastCalledWith(ACME)
  })

  it('refuses a user with no installation at all', async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([])
    mockPrisma.gitHubInstallationRepo.findMany.mockResolvedValue([])
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([])

    await expect(GitHubClient.forUser(USER)).rejects.toThrow(/No GitHub integration/)
  })
})
