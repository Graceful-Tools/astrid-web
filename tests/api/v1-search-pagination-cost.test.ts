/**
 * Task f9ba26b3 — search ran its expensive predicate TWICE per request.
 *
 * `q=roadmap` becomes `ILIKE '%roadmap%'` over task titles, task descriptions
 * AND comment content, with no pg_trgm index behind any of them (the index is
 * the schema task 466c10f1, parked pending production query plans). The route
 * then ran the identical predicate a second time as a `count`, purely to work
 * out whether a next page existed.
 *
 * It is not one wasted scan, it is one per page. The only consumer,
 * hooks/use-task-search.ts, walks EVERY page — and reads only `tasks[].id` and
 * `nextCursor`. It has never looked at `total`. So a 1,000-match query paid for
 * twenty full scans to deliver ten pages, and half of them answered a question
 * nobody asked.
 *
 * Asking for one row more than the page size answers "is there another page?"
 * exactly, for the cost of one row. The count is now opt-in — and on the last
 * page the total is exact anyway, because reaching the end is what makes it
 * knowable for free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:read'], source: 'oauth' }, ctx),
}))

const taskFindMany = vi.hoisted(() => vi.fn())
const taskCount = vi.hoisted(() => vi.fn())
const listFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: taskFindMany, count: taskCount },
    taskList: { findMany: listFindMany },
  },
}))

import { GET } from '@/app/api/v1/search/route'

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `task-${i}`, title: `roadmap ${i}` }))

function search(query: string) {
  return GET(
    new NextRequest(`http://localhost/api/v1/search?${query}`),
    { params: Promise.resolve({}) } as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listFindMany.mockResolvedValue([])
  taskCount.mockResolvedValue(0)
})

describe('search does not scan twice to paginate (task f9ba26b3)', () => {
  it('does NOT run the count on a normal request', async () => {
    taskFindMany.mockResolvedValue(rows(5))

    const body = await (await search('q=roadmap&limit=10')).json()

    expect(taskCount).not.toHaveBeenCalled()
    expect(body.tasks).toHaveLength(5)
  })

  it('asks for ONE row beyond the page to decide whether a next page exists', async () => {
    taskFindMany.mockResolvedValue(rows(5))

    await search('q=roadmap&limit=10')

    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11, skip: 0 }))
  })

  it('does not leak the probe row into the results', async () => {
    // The whole point of limit+1: the extra row is a signal, not a result. Ship
    // it and every page silently returns one item too many.
    taskFindMany.mockResolvedValue(rows(11))

    const body = await (await search('q=roadmap&limit=10')).json()

    expect(body.tasks).toHaveLength(10)
    expect(body.nextCursor).toBe('10')
  })

  it('reports no next page when the probe row does not come back', async () => {
    taskFindMany.mockResolvedValue(rows(10))

    const body = await (await search('q=roadmap&limit=10')).json()

    expect(body.nextCursor).toBeNull()
  })

  it('advances the cursor from the OFFSET, not from the row count', async () => {
    taskFindMany.mockResolvedValue(rows(11))

    const body = await (await search('q=roadmap&limit=10&cursor=30')).json()

    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 30, take: 11 }))
    expect(body.nextCursor).toBe('40')
  })

  it('gives an exact total for free on the LAST page', async () => {
    // Reaching the end is what makes the total knowable without a scan.
    taskFindMany.mockResolvedValue(rows(4))

    const body = await (await search('q=roadmap&limit=10&cursor=20')).json()

    expect(body.total).toBe(24)
    expect(taskCount).not.toHaveBeenCalled()
  })

  it('reports total as null, not a wrong number, when it declines to count', async () => {
    // A plausible-looking 10 here would be read as "10 matches" by anyone
    // rendering a result count. Unknown has to look unknown.
    taskFindMany.mockResolvedValue(rows(11))

    const body = await (await search('q=roadmap&limit=10')).json()

    expect(body.total).toBeNull()
  })

  it('still counts exactly when the caller explicitly asks', async () => {
    taskFindMany.mockResolvedValue(rows(11))
    taskCount.mockResolvedValue(412)

    const body = await (await search('q=roadmap&limit=10&includeTotal=true')).json()

    expect(taskCount).toHaveBeenCalledTimes(1)
    expect(body.total).toBe(412)
    expect(body.nextCursor).toBe('10')
  })

  it('keeps the empty-query short circuit free of any query at all', async () => {
    const body = await (await search('q=')).json()

    expect(taskFindMany).not.toHaveBeenCalled()
    expect(taskCount).not.toHaveBeenCalled()
    expect(body).toMatchObject({ tasks: [], lists: [], total: 0, nextCursor: null })
  })
})
