/**
 * RED for task e0613ae5 — "popular" public lists are not sorted by popularity
 * on v1.
 *
 * Found by reading the legacy↔v1 pair, which is the thing that keeps paying
 * off on this task even where the pair turns out not to be collapsible.
 *
 *   legacy  getPopularPublicLists (lib/copy-utils.ts)
 *           orderBy: [{ copyCount: 'desc' }, { createdAt: 'desc' }]
 *
 *   v1      case 'popular': default:
 *           orderBy = { createdAt: 'desc' }
 *           // "We'll sort by createdAt for now, can enhance with task count later"
 *
 * So on v1 "popular" means "newest". The comment is honest about it, which is
 * how it survived — it reads as a known placeholder rather than a bug.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: `popular` is also v1's DEFAULT branch, so
 * this is not an obscure sort option. It is what a client gets when it asks for
 * public lists with no sortBy at all. A list with a high copyCount — the thing
 * copyCount exists to measure — never surfaces on the v1 path, while the same
 * request on legacy puts it first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest) => handler(req, { userId: 'user-1', scopes: ['lists:read'], source: 'oauth' }),
}))

const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { taskList: { findMany } } }))

vi.mock('@/lib/task-count-utils', () => ({
  getTaskCountInclude: () => ({}),
  getMultipleListTaskCounts: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/api-auth-middleware', () => ({ getDeprecationWarning: () => null }))

function get(query = '') {
  return new NextRequest(`http://localhost/api/v1/public/lists${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
})

async function orderByFor(query: string) {
  const { GET } = await import('@/app/api/v1/public/lists/route')
  await GET(get(query), undefined as never)
  return findMany.mock.calls[0][0].orderBy
}

describe('v1 public lists sort order (task e0613ae5)', () => {
  it('sorts "popular" by copyCount, matching the legacy route', async () => {
    // Legacy: orderBy: [{ copyCount: 'desc' }, { createdAt: 'desc' }].
    // createdAt is the TIE-BREAK, not the sort.
    expect(await orderByFor('?sortBy=popular')).toEqual([
      { copyCount: 'desc' },
      { createdAt: 'desc' },
    ])
  })

  it('sorts by popularity when no sortBy is given, since popular is the default', async () => {
    // The case that makes this more than an obscure option.
    expect(await orderByFor('')).toEqual([
      { copyCount: 'desc' },
      { createdAt: 'desc' },
    ])
  })

  it('still sorts "recent" by createdAt', async () => {
    expect(await orderByFor('?sortBy=recent')).toEqual({ createdAt: 'desc' })
  })

  it('still sorts "name" alphabetically', async () => {
    expect(await orderByFor('?sortBy=name')).toEqual({ name: 'asc' })
  })

  it('falls back to popularity for an unrecognised sortBy', async () => {
    // An unknown value must not silently become "newest" either.
    expect(await orderByFor('?sortBy=banana')).toEqual([
      { copyCount: 'desc' },
      { createdAt: 'desc' },
    ])
  })
})
