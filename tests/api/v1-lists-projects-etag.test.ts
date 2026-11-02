/**
 * GET /api/v1/lists and GET /api/v1/projects answer a conditional read
 * (AWTD-1509, AWTD-1514).
 *
 * astrid-core clients re-read both on every background pass. Without an ETag
 * the whole payload is re-sent and re-parsed each time even when nothing
 * moved. `features` has done this since it was written; these two now match:
 * ETag on every 200, 304 with no body when If-None-Match matches, and
 * `Cache-Control: private, no-cache` because both responses are per-user.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row, rowsWith } from '../fixtures/prisma-rows'
import { mockPrisma } from '../setup'
import { GET as GET_LISTS } from '@/app/api/v1/lists/route'
import { GET as GET_PROJECTS } from '@/app/api/v1/projects/route'
import { authenticateAPI, requireScopes, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { listProjectsForUser } from '@/lib/projects-service'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userListsV1: (userId: string) => `lists:user:${userId}:v1` },
    getOrSet: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: { userLists: vi.fn() },
  },
}))

vi.mock('@/lib/favorites', () => ({ hydrateListFavorites: vi.fn(async () => {}) }))

vi.mock('@/lib/task-count-utils', () => ({
  getTaskCountInclude: () => ({ _count: { select: { tasks: true } } }),
  getMultipleListTaskCounts: vi.fn(async () => ({})),
}))

vi.mock('@/lib/projects-service', () => ({
  listProjectsForUser: vi.fn(),
  createProjectForUser: vi.fn(),
}))

const mockListProjects = vi.mocked(listProjectsForUser)

const list = (id: string, name: string, updatedAt = '2026-11-01T00:00:00.000Z') =>
  ({
    id,
    ownerId: 'user-1',
    name,
    description: '',
    color: '#3b82f6',
    privacy: 'PRIVATE',
    owner: { id: 'user-1', name: 'U', email: 'u@example.com', image: null, isAIAgent: false, aiAgentType: null },
    listMembers: [],
    listInvites: [],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date(updatedAt),
  }) as Record<string, unknown>

const project = (id: string, name: string) => ({ id, name, key: 'P', lists: [] })

const get = (path: string, etag?: string) =>
  new Request(`https://x.example${path}`, etag ? { headers: { 'If-None-Match': etag } } : {}) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue(
    row({ userId: 'user-1', source: 'oauth', scopes: ['lists:read', 'projects:read'] }),
  )
  vi.mocked(requireScopes).mockImplementation(() => {})
  vi.mocked(getDeprecationWarning).mockReturnValue(null)
  mockPrisma.taskList.findMany.mockResolvedValue(rowsWith([list('l1', 'Inbox'), list('l2', 'Work')]))
  mockListProjects.mockResolvedValue([project('p1', 'Board')] as never)
})

describe('GET /api/v1/lists — conditional read (AWTD-1509)', () => {
  it('tags a 200 and marks it private (AWTD-1509)', async () => {
    const res = await GET_LISTS(get('/api/v1/lists'))
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toMatch(/^"lists-[A-Za-z0-9_-]+"$/)
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
  })

  it('answers 304 with no body when If-None-Match quotes the tag (AWTD-1509)', async () => {
    const first = await GET_LISTS(get('/api/v1/lists'))
    const etag = first.headers.get('ETag')!

    const second = await GET_LISTS(get('/api/v1/lists', etag))
    expect(second.status).toBe(304)
    expect(second.headers.get('ETag')).toBe(etag)
    expect(await second.text()).toBe('')
  })

  it('keeps the tag stable although serverTime and timestamp move (AWTD-1509)', async () => {
    const a = await GET_LISTS(get('/api/v1/lists'))
    await new Promise(r => setTimeout(r, 5))
    const b = await GET_LISTS(get('/api/v1/lists'))
    expect(b.headers.get('ETag')).toBe(a.headers.get('ETag'))
  })

  it('changes the tag when a list is removed from the caller (membership, AWTD-1509)', async () => {
    const before = (await GET_LISTS(get('/api/v1/lists'))).headers.get('ETag')!
    mockPrisma.taskList.findMany.mockResolvedValue(rowsWith([list('l1', 'Inbox')]))
    const after = await GET_LISTS(get('/api/v1/lists', before))
    expect(after.status).toBe(200)
    expect(after.headers.get('ETag')).not.toBe(before)
  })

  it('changes the tag when a list is renamed (AWTD-1509)', async () => {
    const before = (await GET_LISTS(get('/api/v1/lists'))).headers.get('ETag')!
    mockPrisma.taskList.findMany.mockResolvedValue(
      rowsWith([list('l1', 'Inbox'), list('l2', 'Work, renamed', '2026-11-02T00:00:00.000Z')]),
    )
    const after = await GET_LISTS(get('/api/v1/lists', before))
    expect(after.status).toBe(200)
    expect(after.headers.get('ETag')).not.toBe(before)
  })

  it('accepts the tag inside a comma-separated or weak If-None-Match (AWTD-1509)', async () => {
    const etag = (await GET_LISTS(get('/api/v1/lists'))).headers.get('ETag')!
    expect((await GET_LISTS(get('/api/v1/lists', `"other", ${etag}`))).status).toBe(304)
    expect((await GET_LISTS(get('/api/v1/lists', `W/${etag}`))).status).toBe(304)
  })
})

describe('GET /api/v1/projects — conditional read (AWTD-1514)', () => {
  it('a second GET quoting the first ETag gets 304 with an empty body (AWTD-1514)', async () => {
    const first = await GET_PROJECTS(get('/api/v1/projects'))
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('private, no-cache')
    const etag = first.headers.get('ETag')!
    expect(etag).toMatch(/^"projects-[A-Za-z0-9_-]+"$/)

    const second = await GET_PROJECTS(get('/api/v1/projects', etag))
    expect(second.status).toBe(304)
    expect(second.headers.get('ETag')).toBe(etag)
    expect(await second.text()).toBe('')
  })

  it('changes the tag when a project is created (AWTD-1514)', async () => {
    const before = (await GET_PROJECTS(get('/api/v1/projects'))).headers.get('ETag')!
    mockListProjects.mockResolvedValue([project('p1', 'Board'), project('p2', 'New')] as never)
    const after = await GET_PROJECTS(get('/api/v1/projects', before))
    expect(after.status).toBe(200)
    expect(after.headers.get('ETag')).not.toBe(before)
  })

  it('changes the tag when a project is renamed (AWTD-1514)', async () => {
    const before = (await GET_PROJECTS(get('/api/v1/projects'))).headers.get('ETag')!
    mockListProjects.mockResolvedValue([project('p1', 'Board renamed')] as never)
    const after = await GET_PROJECTS(get('/api/v1/projects', before))
    expect(after.status).toBe(200)
    expect(after.headers.get('ETag')).not.toBe(before)
  })
})
