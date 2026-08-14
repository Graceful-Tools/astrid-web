/**
 * Task e0613ae5 — sixth slice of collapsing the duplicated legacy↔v1 routes.
 *
 * `GET /api/github/repositories` and its v1 twin were byte-identical in both
 * logic and response. Like github/status they stay two routes because the auth
 * differs, and only the rule moves to lib/.
 *
 * The behaviours worth pinning are the two degradation paths, since those are
 * where a refactor quietly changes what a user sees:
 *   - a failed refresh must fall back to the cache, not error
 *   - the no-integration response is its own shape (`message`, and NO
 *     `cached`/`lastRefreshed`), not the normal shape with fields missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gitHubIntegration: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

const getInstallationRepositories = vi.fn()
vi.mock('@/lib/github-client', () => ({
  GitHubClient: { forUser: vi.fn(async () => ({ getInstallationRepositories })) },
}))

import { listGitHubRepositories } from '@/lib/github-repositories'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

const UPDATED_AT = new Date('2026-08-10T12:00:00.000Z')

const INTEGRATION = {
  id: 'gh-1',
  userId: 'u-1',
  installationId: 111,
  updatedAt: UPDATED_AT,
  repositories: [
    // Cached rows may predate the camelCase mapping.
    { id: 1, name: 'astrid-web', full_name: 'Graceful-Tools/astrid-web', default_branch: 'master', private: true },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.gitHubIntegration.findFirst.mockResolvedValue({ ...INTEGRATION } as never)
  mockPrisma.gitHubIntegration.update.mockResolvedValue({} as never)
  getInstallationRepositories.mockResolvedValue([])
})

describe('listGitHubRepositories (task e0613ae5)', () => {
  it('returns the no-integration shape, without cached/lastRefreshed', async () => {
    mockPrisma.gitHubIntegration.findFirst.mockResolvedValue(null as never)

    const result = await listGitHubRepositories({ userId: 'u-1', refresh: false })

    expect(result).toEqual({
      repositories: [],
      message: 'No GitHub integration found. Please connect your GitHub account first.',
    })
    // Both original routes omitted these here; adding them would be a silent
    // response-shape change.
    expect('cached' in result).toBe(false)
    expect('lastRefreshed' in result).toBe(false)
  })

  it('serves the cache when no refresh was asked for, normalising snake_case', async () => {
    const result = await listGitHubRepositories({ userId: 'u-1', refresh: false })

    expect(result.repositories).toEqual([
      { id: 1, name: 'astrid-web', fullName: 'Graceful-Tools/astrid-web', defaultBranch: 'master', private: true },
    ])
    expect(result).toMatchObject({ cached: true, lastRefreshed: UPDATED_AT })
    expect(getInstallationRepositories).not.toHaveBeenCalled()
  })

  it('defaults a missing branch to main', async () => {
    mockPrisma.gitHubIntegration.findFirst.mockResolvedValue({
      ...INTEGRATION, repositories: [{ id: 2, name: 'x', full_name: 'o/x' }],
    } as never)

    const result = await listGitHubRepositories({ userId: 'u-1', refresh: false })

    expect(result.repositories[0].defaultBranch).toBe('main')
    expect(result.repositories[0].private).toBe(false)
  })

  it('refreshes from GitHub and writes the result back to the cache', async () => {
    getInstallationRepositories.mockResolvedValue([
      { id: 9, name: 'fresh', fullName: 'o/fresh', defaultBranch: 'trunk', private: false },
    ])

    const result = await listGitHubRepositories({ userId: 'u-1', refresh: true })

    expect(result.repositories).toEqual([
      { id: 9, name: 'fresh', fullName: 'o/fresh', defaultBranch: 'trunk', private: false },
    ])
    expect(mockPrisma.gitHubIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gh-1' } }),
    )
    expect(result).toMatchObject({ cached: false })
  })

  it('falls back to the cache when the refresh throws', async () => {
    // The user asked for fresher data. Failing to get it should not make the
    // list disappear.
    getInstallationRepositories.mockRejectedValue(new Error('GitHub down'))

    const result = await listGitHubRepositories({ userId: 'u-1', refresh: true })

    expect(result.repositories).toEqual([
      { id: 1, name: 'astrid-web', fullName: 'Graceful-Tools/astrid-web', defaultBranch: 'master', private: true },
    ])
  })

  it('does not call GitHub when there is no installation id, even on refresh', async () => {
    mockPrisma.gitHubIntegration.findFirst.mockResolvedValue({
      ...INTEGRATION, installationId: null,
    } as never)

    await listGitHubRepositories({ userId: 'u-1', refresh: true })

    expect(getInstallationRepositories).not.toHaveBeenCalled()
  })
})
