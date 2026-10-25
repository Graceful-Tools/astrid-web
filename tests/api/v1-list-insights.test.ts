/**
 * GET /api/v1/lists/:id/insights (AWTD-1329) — the wiring around the pure
 * computation in lib/list-insights.ts: who may read it, which inputs it
 * accepts, and that a board gets its lanes in column order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const listFindUnique = vi.hoisted(() => vi.fn())
const taskFindMany = vi.hoisted(() => vi.fn())
const eventFindMany = vi.hoisted(() => vi.fn())
const commentFindMany = vi.hoisted(() => vi.fn())
const projectFindUnique = vi.hoisted(() => vi.fn())
const userFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: listFindUnique },
    task: { findMany: taskFindMany },
    taskEvent: { findMany: eventFindMany },
    comment: { findMany: commentFindMany },
    project: { findUnique: projectFindUnique },
    user: { findMany: userFindMany },
  },
}))
vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'member-1', scopes: ['lists:read'], source: 'oauth' }, ctx),
}))

import { GET } from '@/app/api/v1/lists/[id]/insights/route'
import { RedisCache } from '@/lib/redis'

const ctx = { params: Promise.resolve({ id: 'list-1' }) } as never
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/lists/list-1/insights${query}`) as never, ctx)

const LIST = {
  id: 'list-1',
  ownerId: 'owner-1',
  privacy: 'PRIVATE',
  projectId: null,
  listMembers: [{ userId: 'member-1', role: 'member' }],
  project: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  listFindUnique.mockResolvedValue(LIST)
  taskFindMany.mockResolvedValue([
    { id: 't1', createdAt: new Date(), creatorId: 'member-1', completed: false, completedAt: null, repeating: 'never' },
  ])
  eventFindMany.mockResolvedValue([])
  commentFindMany.mockResolvedValue([])
  projectFindUnique.mockResolvedValue(null)
  userFindMany.mockResolvedValue([{ id: 'member-1', name: 'Member', image: null, isAIAgent: false }])
})

describe('GET /api/v1/lists/:id/insights (AWTD-1329)', () => {
  it('answers a member with the last 30 days by default', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { insights } = await res.json()
    expect(insights.window).toMatchObject({ days: 30, timeZone: 'UTC' })
    expect(insights.series).toHaveLength(30)
    expect(insights.totals.created).toBe(1)
    expect(insights.contributors[0]).toMatchObject({ userId: 'member-1', created: 1 })
    expect(insights.lanes).toBeNull()
  })

  it('answers 404 to someone who cannot see the list, as for a list that does not exist', async () => {
    listFindUnique.mockResolvedValue({ ...LIST, listMembers: [] })
    expect((await get()).status).toBe(404)
    listFindUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    expect(taskFindMany).not.toHaveBeenCalled()
  })

  it('accepts only the windows the clients offer, and real time zones', async () => {
    expect((await get('?days=7')).status).toBe(200)
    expect((await get('?days=90')).status).toBe(200)
    expect((await get('?days=365')).status).toBe(400)
    expect((await get('?days=abc')).status).toBe(400)
    expect((await get('?tz=America/Los_Angeles')).status).toBe(200)
    expect((await get('?tz=Mars/Olympus')).status).toBe(400)
  })

  it('gives a board its lanes in column order, Inbox first and Done left out', async () => {
    listFindUnique.mockResolvedValue({ ...LIST, projectId: 'project-1' })
    projectFindUnique.mockResolvedValue({
      customStates: [{ role: 'review', name: 'Review', order: 3 }],
    })
    const { insights } = await (await get()).json()
    expect(insights.lanes.map((lane: { role: string }) => lane.role)).toEqual([
      'inbox', 'ready', 'doing', 'waiting', 'review',
    ])
  })

  it('does not query history for an empty list', async () => {
    taskFindMany.mockResolvedValue([])
    const res = await get()
    expect(res.status).toBe(200)
    expect(eventFindMany).not.toHaveBeenCalled()
    expect(commentFindMany).not.toHaveBeenCalled()
  })

  it('caches the answer per list, window, zone and viewer day for five minutes (AWTD-1358)', async () => {
    const res = await get('?days=7&tz=America/Los_Angeles')
    expect(res.status).toBe(200)
    expect(RedisCache.getOrSet).toHaveBeenCalledWith(
      expect.stringMatching(/^insights:list:list-1:7:America\/Los_Angeles:\d{4}-\d{2}-\d{2}$/),
      expect.any(Function),
      300,
    )
  })

  it('checks access before the cache, so a cached answer never reaches someone who cannot see the list', async () => {
    listFindUnique.mockResolvedValue({ ...LIST, listMembers: [] })
    const res = await get()
    expect(res.status).toBe(404)
    expect(RedisCache.getOrSet).not.toHaveBeenCalled()
  })
})
