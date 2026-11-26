import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildListCreate, buildTaskCreate, buildUserCreate } from '@/tests/fixtures/prisma'
import { cleanupPrefix, connectAppPrisma, runPrefix } from './support/db'

/**
 * ADEV-294: GET /api/v1/tasks delta sync (`updatedSince`) and the keyset cursor walk,
 * through the real route handler and real Postgres. Only authentication is replaced:
 * it needs a session or token, and what is under test is the query behind it.
 */
let currentUserId = ''
vi.mock('@/lib/api-auth-middleware', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-auth-middleware')>()
  return {
    ...actual,
    authenticateAPI: vi.fn(async () => ({
      userId: currentUserId,
      source: 'oauth',
      scopes: ['*'],
      isAIAgent: false,
      user: { id: currentUserId, email: 'caller@example.test', name: 'Caller', isAIAgent: false },
    })),
  }
})

let prisma: PrismaClient
const prefix = runPrefix('v1sync')
let GET: (req: NextRequest) => Promise<Response>

beforeAll(async () => {
  prisma = await connectAppPrisma()
  ;({ GET } = await import('@/app/api/v1/tasks/route'))
})

afterAll(async () => {
  if (prisma) {
    await cleanupPrefix(prisma, prefix)
    await prisma.$disconnect()
  }
})

async function seedUserWithList() {
  const user = await prisma.user.create({
    data: buildUserCreate({ email: `${prefix}-${Math.random().toString(36).slice(2)}@example.test` }),
  })
  const list = await prisma.taskList.create({ data: buildListCreate(user.id) })
  currentUserId = user.id
  return { user, list }
}

/** Pin `updatedAt` (Prisma's @updatedAt would otherwise stamp now) so ordering is deterministic. */
async function createTaskAt(userId: string, listId: string, title: string, updatedAt: string) {
  const task = await prisma.task.create({
    data: buildTaskCreate(userId, listId, { title: `${prefix}-${title}` }),
  })
  await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = ${new Date(updatedAt)} WHERE id = ${task.id}`
  return task
}

async function get(query: string) {
  const res = await GET(new NextRequest(`http://localhost/api/v1/tasks?${query}`))
  expect(res.status).toBe(200)
  return (await res.json()) as {
    tasks: Array<{ id: string; title: string; listIds: string[] }>
    nextCursor?: string
    deletedIds?: string[]
    serverTime: string
    meta: { total: number }
  }
}

describe('GET /api/v1/tasks against real rows (ADEV-294)', () => {
  beforeEach(() => {
    currentUserId = ''
  })

  it('returns only tasks updated strictly after updatedSince', async () => {
    const { user, list } = await seedUserWithList()
    const old = await createTaskAt(user.id, list.id, 'old', '2026-01-01T00:00:00.000Z')
    const boundary = await createTaskAt(user.id, list.id, 'boundary', '2026-02-01T00:00:00.000Z')
    const fresh = await createTaskAt(user.id, list.id, 'fresh', '2026-03-01T00:00:00.000Z')

    const delta = await get(`updatedSince=${encodeURIComponent('2026-02-01T00:00:00.000Z')}`)

    expect(delta.tasks.map(t => t.id)).toEqual([fresh.id])
    expect(delta.tasks.map(t => t.id)).not.toContain(boundary.id)
    expect(delta.deletedIds).toEqual([])
    expect(delta.meta.total).toBe(1)

    const full = await get('')
    expect(new Set(full.tasks.map(t => t.id))).toEqual(new Set([old.id, boundary.id, fresh.id]))
    expect(full).not.toHaveProperty('deletedIds')
  })

  it('reports list membership from the join table as listIds', async () => {
    const { user, list } = await seedUserWithList()
    const task = await createTaskAt(user.id, list.id, 'member', '2026-03-01T00:00:00.000Z')

    const page = await get(`listId=${list.id}`)

    expect(page.tasks.find(t => t.id === task.id)?.listIds).toEqual([list.id])
  })

  it("does not return another user's private tasks, even with a fresh updatedSince", async () => {
    const { user, list } = await seedUserWithList()
    await createTaskAt(user.id, list.id, 'mine', '2026-03-01T00:00:00.000Z')
    const other = await prisma.user.create({
      data: buildUserCreate({ email: `${prefix}-other-${Math.random().toString(36).slice(2)}@example.test` }),
    })
    const otherList = await prisma.taskList.create({ data: buildListCreate(other.id) })
    const theirs = await createTaskAt(other.id, otherList.id, 'theirs', '2026-03-02T00:00:00.000Z')

    const delta = await get('updatedSince=2026-01-01T00:00:00.000Z')

    expect(delta.tasks.map(t => t.id)).not.toContain(theirs.id)
    expect(delta.tasks).toHaveLength(1)
  })

  it('walks tied updatedAt values exactly once with the keyset cursor', async () => {
    const { user, list } = await seedUserWithList()
    const sameInstant = '2026-03-05T10:00:00.000Z'
    const created = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(name => createTaskAt(user.id, list.id, `tie-${name}`, sameInstant)),
    )

    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await get(`limit=2&cursor=${cursor ? encodeURIComponent(cursor) : ''}`)
      seen.push(...page.tasks.map(t => t.id))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 10)

    expect(pages).toBe(3)
    expect(seen).toHaveLength(5)
    expect(new Set(seen)).toEqual(new Set(created.map(t => t.id)))
    // Ordered by (updatedAt, id): the walk is stable, not just complete.
    expect(seen).toEqual([...seen].sort())
  })

  it('answers 400 for a malformed cursor instead of silently emptying the list', async () => {
    await seedUserWithList()
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?cursor=not-a-cursor'))
    expect(res.status).toBe(400)
  })
})
