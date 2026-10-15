/**
 * @vitest-environment node
 *
 * AWTD-1236, implementing the decision on AWTD-1233.
 *
 * `GET /api/v1/tasks?limit=1000` measured 551.8 KiB on the wire against a
 * 500 KiB budget, and `description` was 443.3 KiB of it — 80%. The route is
 * doing two jobs: it is the list view's read AND the clients' full sync. A
 * list view needs titles; only the sync needs descriptions.
 *
 * `?omit=description` lets a caller stop paying for the other job's payload.
 * It is additive, so these tests pin BOTH halves: the omission works, and
 * omitting the parameter changes nothing. The second half is the one that
 * protects every client that has not heard of this yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/tasks/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  getDeprecationWarning: vi.fn(() => null),
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

/** What Prisma returns when `description` is left out of the select. */
const LEAN_ROW = {
  id: 'task-1',
  title: 'A task',
  lists: [{ id: 'list-1', ownerId: 'user-1', name: 'L', color: '#fff' }],
  assigneeId: null,
  assigneeIds: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthenticateAPI.mockResolvedValue({
    userId: 'user-1', source: 'oauth', scopes: ['tasks:read'],
  } as never)
  mockRequireScopes.mockImplementation(() => {})
  mockPrisma.task.findMany.mockResolvedValue([] as never)
  mockPrisma.task.count.mockResolvedValue(0 as never)
})

function get(query: string) {
  return GET(new NextRequest(`https://${BRAND.domain}/api/v1/tasks${query}`) as never, undefined as never)
}

/** The `select` Prisma was actually asked for. */
function selectFromLastCall() {
  return mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.select
}

describe('GET /api/v1/tasks — ?omit=description', () => {
  it('does not ask Prisma for description when it is omitted', async () => {
    await get('?omit=description')

    // Not `description: false` — the key must be absent from the select, which
    // is what makes it absent from the row and so from the JSON.
    expect(selectFromLastCall()).not.toHaveProperty('description')
  })

  it('still asks for description when omit is absent', async () => {
    // The additive guarantee. Every existing client depends on this line.
    await get('?limit=10')

    expect(selectFromLastCall()?.description).toBe(true)
  })

  it('leaves description absent from the response rather than null', async () => {
    // `null` already means "this task has no description". A client that
    // cannot tell "not sent" from "empty" will overwrite good data with an
    // empty string, which is the one way this change could lose a user's work.
    mockPrisma.task.findMany.mockResolvedValue([LEAN_ROW] as never)

    const body = await (await get('?omit=description')).json()

    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).not.toHaveProperty('description')

    // And the other way round, so the pair says something: a full read still
    // carries the text through the listIds/assigneeIds mapping.
    mockPrisma.task.findMany.mockResolvedValue([
      { ...LEAN_ROW, description: 'the long evidence' },
    ] as never)

    const full = await (await get('?limit=10')).json()

    expect(full.tasks[0].description).toBe('the long evidence')
  })

  it('reports what it dropped in meta.omitted', async () => {
    // A client writing responses into IndexedDB has to know the record it just
    // stored is partial; without this it cannot tell a lean read from a task
    // whose description was deleted.
    const body = await (await get('?omit=description')).json()

    expect(body.meta.omitted).toEqual(['description'])
  })

  it('leaves meta.omitted out of a full response', async () => {
    const body = await (await get('?limit=10')).json()

    expect(body.meta).not.toHaveProperty('omitted')
  })

  it('still returns the fields a list view actually renders', async () => {
    // A lean read must stay useful: dropping description must not take the
    // identity, status or permission fields with it.
    await get('?omit=description')

    const select = selectFromLastCall()
    for (const kept of ['id', 'title', 'completed', 'priority', 'statusRole', 'dueDateTime', 'identifier']) {
      expect(select?.[kept], `${kept} must survive a lean read`).toBe(true)
    }
    expect(select?.lists?.select?.ownerId, 'ownerId drives the permission check').toBe(true)
  })

  it('omits listMembers too, as the one spelling for a lean read', async () => {
    await get('?omit=listMembers')

    expect(selectFromLastCall()?.lists?.select).not.toHaveProperty('listMembers')
  })

  it('keeps leanListMembers=1 working for the client that already sends it', async () => {
    await get('?leanListMembers=1')

    expect(selectFromLastCall()?.lists?.select).not.toHaveProperty('listMembers')
  })

  it('takes both omissions at once', async () => {
    const body = await (await get('?omit=description,listMembers')).json()

    const select = selectFromLastCall()
    expect(select).not.toHaveProperty('description')
    expect(select?.lists?.select).not.toHaveProperty('listMembers')
    expect([...body.meta.omitted].sort()).toEqual(['description', 'listMembers'])
  })

  it('ignores a field it does not know instead of answering 400', async () => {
    const response = await get('?omit=somethingNew')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(selectFromLastCall()?.description).toBe(true)
    expect(body.meta).not.toHaveProperty('omitted')
  })

  it('does not widen or narrow who can see what', async () => {
    // Bytes only. A payload switch must never touch the visibility clause.
    await get('?omit=description')

    expect(mockPrisma.task.findMany.mock.calls.at(-1)?.[0]?.where?.OR).toBeTruthy()
  })
})
