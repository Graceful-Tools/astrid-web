import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mirrorExternalDeletesForTask } from '@/lib/sync/mirror-deletes'
import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalTaskLink: { findMany: vi.fn() },
    integration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sync/github', () => ({
  githubRequest: vi.fn(),
  githubTokenFor: vi.fn(),
}))

vi.mock('@/lib/sync/google', () => ({
  googleRequest: vi.fn(),
  googleTokenFor: vi.fn(),
}))

describe('mirrorExternalDeletesForTask performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.externalTaskLink.findMany).mockResolvedValue([
      {
        integrationId: 'integration-1',
        remoteId: 'repo#1',
        remoteContainerId: 'owner/repo',
        provider: 'GITHUB_ISSUES',
      },
      {
        integrationId: 'integration-1',
        remoteId: 'repo#2',
        remoteContainerId: 'owner/repo',
        provider: 'GITHUB_ISSUES',
      },
    ] as never)
    vi.mocked(prisma.integration.findMany).mockResolvedValue([
      {
        id: 'integration-1',
        userId: 'user-1',
        revokedAt: null,
        metadata: { tombstonedRemoteIds: 'repo#0' },
      },
    ] as never)
    vi.mocked(prisma.integration.update).mockResolvedValue({} as never)
    vi.mocked(githubTokenFor).mockResolvedValue('token')
    vi.mocked(githubRequest).mockResolvedValue({} as never)
  })

  it('AWTD-performance loads integrations in one query and persists all tombstones once', async () => {
    await mirrorExternalDeletesForTask('task-1')

    expect(prisma.integration.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['integration-1'] } },
    })
    expect(prisma.integration.findUnique).not.toHaveBeenCalled()
    expect(prisma.integration.update).toHaveBeenCalledTimes(1)
    expect(prisma.integration.update).toHaveBeenCalledWith({
      where: { id: 'integration-1' },
      data: {
        metadata: {
          tombstonedRemoteIds: 'repo#0,repo#1,repo#2',
        },
      },
    })
    expect(githubTokenFor).toHaveBeenCalledTimes(1)
    expect(githubRequest).toHaveBeenCalledTimes(2)
  })
})
