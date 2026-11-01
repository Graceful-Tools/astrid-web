/**
 * @vitest-environment node
 *
 * AWTD-1470 — a server-issued sync cursor on GET /api/v1/tasks and /api/v1/lists.
 *
 * Clients paged the full sync by `offset` and stamped their OWN clock as the
 * next `updatedSince` (astrid-core asks `stamp − 5 min` to cover skew; web does
 * the same). Offset pages over a mutable ordering shift under a concurrent
 * write: a row moving to an earlier page pushes another past the boundary and
 * the walk never returns it.
 *
 * The fix is additive: `serverTime` on every response, and a keyset cursor on
 * `(updatedAt, id)` that `?cursor=` follows. These tests run the route against
 * an in-memory table that honours the where/orderBy/take/skip the route asks
 * for, so they check the walk's outcome rather than the query's spelling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET as getTasks } from '@/app/api/v1/tasks/route'
import { GET as getLists } from '@/app/api/v1/lists/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  getDeprecationWarning: vi.fn(() => null),
}))

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

type Row = { id: string; creatorId: string; updatedAt: Date; createdAt: Date; completed: boolean; priority: number; title: string }

// ── A table that evaluates the Prisma subset the route uses ─────────────
function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a
  const bv = b instanceof Date ? b.getTime() : b
  if (typeof av === 'boolean' && typeof bv === 'boolean') return Number(av) - Number(bv)
  return (av as any) < (bv as any) ? -1 : (av as any) > (bv as any) ? 1 : 0
}

function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some(c => matches(row, c))
    if (key === 'AND') return (cond as any[]).every(c => matches(row, c))
    // Relation filters (lists.some …) — no row in this table has lists, so
    // a relation clause never matches; the visibility OR passes on creatorId.
    if (key === 'lists') return false
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ('gt' in c && !(cmp(value, c.gt) > 0)) return false
      if ('gte' in c && !(cmp(value, c.gte) >= 0)) return false
      if ('lt' in c && !(cmp(value, c.lt) < 0)) return false
      if ('equals' in c && cmp(value, c.equals) !== 0) return false
      return true
    }
    return cmp(value, cond) === 0
  })
}

function query(table: Row[], args: any): Row[] {
  let out = table.filter(r => matches(r, args.where))
  const order: Array<Record<string, 'asc' | 'desc'>> = Array.isArray(args.orderBy)
    ? args.orderBy
    : args.orderBy ? [args.orderBy] : []
  out = [...out].sort((a, b) => {
    for (const o of order) {
      const [field, dir] = Object.entries(o)[0]
      const c = cmp((a as any)[field], (b as any)[field])
      if (c !== 0) return dir === 'asc' ? c : -c
    }
    return 0
  })
  const skip = args.skip ?? 0
  return out.slice(skip, args.take === undefined ? undefined : skip + args.take)
}

let table: Row[] = []
let clock = Date.parse('2026-11-01T00:00:00.000Z')
const tick = () => new Date(clock += 1000)

function seed(n: number) {
  table = []
  // Many rows share an updatedAt (a bulk import), so the id tiebreak matters.
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.parse('2026-10-01T00:00:00.000Z') + Math.floor(i / 7) * 1000)
    table.push({
      id: `task-${String(i).padStart(5, '0')}`,
      creatorId: 'user-1',
      updatedAt: at,
      createdAt: at,
      completed: false,
      priority: i % 4,
      title: `Task ${i}`,
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'user-1', source: 'oauth', scopes: ['tasks:read', 'lists:read'] } as never)
  vi.mocked(requireScopes).mockImplementation(() => {})
  mockPrisma.task.findMany.mockImplementation((async (args: any) => query(table, args)) as never)
  mockPrisma.task.count.mockImplementation((async (args: any) => table.filter(r => matches(r, args.where)).length) as never)
  mockPrisma.deletionLog.findMany.mockResolvedValue([] as never)
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
})

function tasksGet(query: string) {
  return getTasks(new NextRequest(`https://${BRAND.domain}/api/v1/tasks${query}`) as never, undefined as never)
}

describe('AWTD-1470 — keyset sync cursor on GET /api/v1/tasks', () => {
  it('pages 2,500 tasks by cursor while one is updated mid-walk and returns every task exactly once', async () => {
    seed(2500)
    const seen = new Map<string, number>()
    let cursor: string | undefined = ''
    let pages = 0

    while (cursor !== undefined) {
      const res = await tasksGet(`?limit=1000&cursor=${encodeURIComponent(cursor)}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      for (const t of body.tasks) seen.set(t.id, (seen.get(t.id) ?? 0) + 1)
      pages++

      if (pages === 1) {
        // A task the walk has NOT reached yet is edited. Under offset paging
        // with the default order this shifts rows across the page boundary;
        // under the keyset it simply moves to the tail and is returned once.
        const victim = table.find(r => r.id === 'task-02000')!
        victim.updatedAt = tick()
        victim.priority = 3
      }
      cursor = body.nextCursor
      expect(pages).toBeLessThan(10)
    }

    expect(seen.size).toBe(2500)
    expect([...seen.values()].every(n => n === 1)).toBe(true)
  })

  it('a task edited after the walk returned it comes back again with its new state, never lost', async () => {
    seed(30)
    const first = await (await tasksGet('?limit=10&cursor=')).json()
    const edited = table.find(r => r.id === first.tasks[0].id)!
    edited.updatedAt = tick()
    edited.title = 'edited'

    const all = [...first.tasks]
    let cursor = first.nextCursor
    while (cursor) {
      const body = await (await tasksGet(`?limit=10&cursor=${encodeURIComponent(cursor)}`)).json()
      all.push(...body.tasks)
      cursor = body.nextCursor
    }
    const latest = all.filter(t => t.id === edited.id).at(-1)
    expect(latest.title).toBe('edited')
    expect(new Set(all.map(t => t.id)).size).toBe(30)
  })

  it('omits nextCursor on the last page', async () => {
    seed(5)
    const body = await (await tasksGet('?limit=10&cursor=')).json()
    expect(body.tasks).toHaveLength(5)
    expect(body).not.toHaveProperty('nextCursor')
  })

  it('composes with updatedSince — the keyset narrows a delta, never widens it', async () => {
    seed(20)
    const since = table[13].updatedAt.toISOString()
    const body = await (await tasksGet(`?limit=100&cursor=&updatedSince=${encodeURIComponent(since)}`)).json()
    expect(body.tasks.every((t: any) => Date.parse(t.updatedAt) > Date.parse(since))).toBe(true)
    expect(body.deletedIds).toEqual([])
  })

  it('rejects a malformed cursor with 400 instead of restarting the walk', async () => {
    seed(5)
    const res = await tasksGet('?cursor=not-a-cursor')
    expect(res.status).toBe(400)
  })

  it('carries serverTime, taken before the read, on every response', async () => {
    seed(3)
    const before = Date.now()
    const body = await (await tasksGet('?limit=10')).json()
    expect(typeof body.serverTime).toBe('string')
    expect(Date.parse(body.serverTime)).toBeGreaterThanOrEqual(before - 1)
    expect(Date.parse(body.serverTime)).toBeLessThanOrEqual(Date.now())
  })

  it('leaves the offset response unchanged apart from serverTime (additive)', async () => {
    seed(3)
    const body = await (await tasksGet('?limit=2')).json()
    expect(Object.keys(body).sort()).toEqual(['meta', 'serverTime', 'tasks'])
    expect(body.meta.total).toBe(3)
    expect(body.meta.offset).toBe(0)
    // Offset mode keeps its own order: completed, priority desc, createdAt desc.
    expect(mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.orderBy).toEqual([
      { completed: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' },
    ])
  })
})

describe('AWTD-1470 — serverTime on GET /api/v1/lists', () => {
  it('carries serverTime on a full fetch and on a delta', async () => {
    for (const q of ['', '?updatedSince=2026-10-01T00:00:00.000Z']) {
      const res = await getLists(new Request(`https://x.example/api/v1/lists${q}`) as never, undefined as never)
      const body = await res.json()
      expect(typeof body.serverTime, `serverTime on "${q}"`).toBe('string')
      expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false)
    }
  })
})
