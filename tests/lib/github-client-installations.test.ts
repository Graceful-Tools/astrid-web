/**
 * AWTD-1107 — the coding-agent GitHub client must act through the installation
 * that actually owns a repo.
 *
 * `forUser` used to read only the user's FIRST `GitHubIntegration` row, and
 * `getInstallationIdForRepo` fell back to that row's installation for any repo
 * it did not recognise. So a user with two orgs got the first org's token for
 * the second org's repos: the call failed, or acted through the wrong org.
 *
 * Each integration row caches only its own installation's repos, so the row —
 * not the entry, which the webhook and refresh wrote without an installationId
 * — is what says which installation a repo belongs to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gitHubIntegration: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

// One fake Octokit per installation, so a test can see whose token was used.
type FakeOctokit = {
  request: ReturnType<typeof vi.fn>
  apps: { listReposAccessibleToInstallation: ReturnType<typeof vi.fn> }
}
const octokits = new Map<number, FakeOctokit>()
function octokitFor(installationId: number) {
  let octokit = octokits.get(installationId)
  if (!octokit) {
    octokit = {
      apps: {
        listReposAccessibleToInstallation: vi.fn(async () => ({
          data: {
            repositories: [{
              id: installationId, name: 'r', full_name: `inst-${installationId}/r`, private: false, default_branch: 'main',
            }],
          },
        })),
      },
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
    octokits.set(installationId, octokit)
  }
  return octokit
}

vi.mock('@/lib/github/app', () => ({
  getGitHubApp: () => ({
    getInstallationOctokit: vi.fn(async (installationId: number) => octokitFor(installationId)),
  }),
}))

import { GitHubClient } from '@/lib/github-client'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)

const ORG_A = {
  id: 'gh-a',
  userId: 'u-1',
  installationId: 111,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  // Written by the installation_repositories webhook: no installationId.
  repositories: [{ id: 1, name: 'web', fullName: 'org-a/web', defaultBranch: 'main' }],
}

const ORG_B = {
  id: 'gh-b',
  userId: 'u-1',
  installationId: 222,
  createdAt: new Date('2026-02-01T00:00:00Z'),
  // Written by listGitHubRepositories' refresh: no installationId either.
  repositories: [{ id: 2, name: 'api', fullName: 'org-b/api', defaultBranch: 'main', private: true }],
}

function integrations(rows: object[]) {
  mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows as never)
  mockPrisma.gitHubIntegration.findFirst.mockResolvedValue((rows[0] ?? null) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  octokits.clear()
})

describe('GitHubClient with several installations (AWTD-1107)', () => {
  it("uses the second installation's token for the second org's repo", async () => {
    integrations([ORG_A, ORG_B])

    const client = await GitHubClient.forUser('u-1')
    await client.getRepository('org-b/api')

    expect(octokits.get(222)?.request).toHaveBeenCalledTimes(1)
    expect(octokits.get(111)?.request ?? vi.fn()).not.toHaveBeenCalled()
  })

  it("still uses the first installation for the first org's repo", async () => {
    integrations([ORG_A, ORG_B])

    const client = await GitHubClient.forUser('u-1')
    await client.getRepository('org-a/web')

    expect(octokits.get(111)?.request).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown repo rather than guessing an installation', async () => {
    integrations([ORG_A, ORG_B])

    const client = await GitHubClient.forUser('u-1')

    await expect(client.getRepository('org-c/other')).rejects.toThrow(/refresh/i)
    for (const octokit of octokits.values()) expect(octokit.request).not.toHaveBeenCalled()
  })

  it('reads cached entries that predate the camelCase mapping', async () => {
    integrations([ORG_A, {
      ...ORG_B,
      repositories: [{ id: 3, name: 'legacy', full_name: 'org-b/legacy' }],
    }])

    const client = await GitHubClient.forUser('u-1')
    await client.getRepository('org-b/legacy')

    expect(octokits.get(222)?.request).toHaveBeenCalledTimes(1)
  })

  it("lists the named installation, and only one of the user's own", async () => {
    integrations([ORG_A, ORG_B])

    const client = await GitHubClient.forUser('u-1')

    await expect(client.getInstallationRepositories(222)).resolves.toEqual([
      { id: 222, name: 'r', fullName: 'inst-222/r', private: false, defaultBranch: 'main' },
    ])
    await expect(client.getInstallationRepositories(999)).rejects.toThrow(/not one of this user/)
  })

  it('keeps using the only installation for a repo it has not cached yet', async () => {
    integrations([ORG_A])

    const client = await GitHubClient.forUser('u-1')
    await client.getRepository('org-a/new-repo')

    expect(octokits.get(111)?.request).toHaveBeenCalledTimes(1)
  })
})
