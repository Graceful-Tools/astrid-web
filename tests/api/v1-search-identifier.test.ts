/**
 * AWTD-1414: typing a task id such as `awtd-1405` into search finds that task,
 * in any case and among other words — and only when the searcher can see it.
 *
 * Web search goes through this route. iOS, Mac, Android and Windows search
 * their synced cache through astrid-core's `searchTasks`, whose parser is held
 * to this one by contracts/fixtures/search.json.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:read'], source: 'oauth' }, ctx),
}))

const taskFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: taskFindMany, count: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/task-identifier', () => ({ canonicalizeIdentifier: vi.fn().mockResolvedValue(null) }))

import { GET } from '@/app/api/v1/search/route'

async function whereFor(q: string) {
  await GET(new NextRequest(`http://localhost/api/v1/search?q=${encodeURIComponent(q)}`), {
    params: Promise.resolve({}),
  } as never)
  return taskFindMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] }
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindMany.mockResolvedValue([])
})

describe('search by task id (AWTD-1414)', () => {
  for (const q of ['awtd-1405', 'AWTD-1405', 'Awtd-1405']) {
    it(`finds AWTD-1405 by its id when typed as "${q}"`, async () => {
      const where = await whereFor(q)
      expect(where.AND).toContainEqual({ identifier: 'AWTD-1405' })
    })
  }

  it('keeps the visibility floor, so an id never reaches a task the searcher cannot see', async () => {
    const where = await whereFor('awtd-1405')
    expect(where.AND[0]).toMatchObject({
      OR: expect.arrayContaining([{ creatorId: 'user-1' }, { assigneeId: 'user-1' }]),
    })
  })

  it('matches the id and the other words together', async () => {
    const where = await whereFor('awtd-1405 e2e')
    expect(where.AND).toContainEqual({ identifier: 'AWTD-1405' })
    expect(JSON.stringify(where.AND)).toContain('"contains":"e2e"')
  })
})
