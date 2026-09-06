/**
 * RED for task 7b2e96ff.
 *
 * getGitHubUserForRepository resolved which user's GitHub token to use. For an
 * AI agent caller it looked up ANY list wired to the named repository, with no
 * check that the agent was on that list — and if that found nothing, it fell
 * through to scanning EVERY GitHubIntegration row and returning whichever
 * stranger had the repo.
 *
 * Agent credentials are obtainable (POST /api/v1/openclaw/register hands them
 * out), so this let anyone read and write any repository that any other user
 * had connected, on that victim's token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.hoisted(() => vi.fn())
const taskListFindFirst = vi.hoisted(() => vi.fn())
const integrationFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    taskList: { findFirst: taskListFindFirst },
    gitHubIntegration: { findMany: integrationFindMany },
  },
}))

const { getGitHubUserForRepository } = await import(
  '@/app/api/mcp/operations/handlers/github-operations'
)

const AGENT = 'agent-user'

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue({ isAIAgent: true, aiAgentType: 'claude' })
  taskListFindFirst.mockResolvedValue(null)
  integrationFindMany.mockResolvedValue([
    { userId: 'unrelated-victim', repositories: [{ fullName: 'victim/private-repo' }] },
  ])
})

describe('getGitHubUserForRepository (task 7b2e96ff)', () => {
  it('never returns a stranger found by scanning all integrations', async () => {
    const resolved = await getGitHubUserForRepository(AGENT, 'victim/private-repo')

    expect(resolved).not.toBe('unrelated-victim')
    expect(integrationFindMany).not.toHaveBeenCalled()
  })

  it('scopes the list lookup to lists the calling agent is on', async () => {
    await getGitHubUserForRepository(AGENT, 'victim/private-repo')

    const where = taskListFindFirst.mock.calls[0][0].where
    expect(where.githubRepositoryId).toBe('victim/private-repo')
    // Some membership constraint naming the caller must be present.
    expect(JSON.stringify(where)).toContain(AGENT)
  })

  it('still uses the configuring user when the agent IS on the list', async () => {
    taskListFindFirst.mockResolvedValue({
      aiAgentConfiguredBy: 'list-owner',
      owner: { id: 'list-owner' },
    })

    expect(await getGitHubUserForRepository(AGENT, 'team/repo')).toBe('list-owner')
  })

  it('leaves a non-agent caller on their own integration', async () => {
    userFindUnique.mockResolvedValue({ isAIAgent: false })

    expect(await getGitHubUserForRepository(AGENT, 'anything/at-all')).toBe(AGENT)
    expect(integrationFindMany).not.toHaveBeenCalled()
  })
})
