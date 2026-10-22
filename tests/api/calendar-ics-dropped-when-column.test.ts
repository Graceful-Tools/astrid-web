/**
 * RED for AWTD-1317.
 *
 * GET /api/calendar/tasks.ics filtered on `Task.when`, a column dropped by
 * migration 20251120000000_remove_task_when_field. Prisma rejects an unknown
 * field before the query runs (PrismaClientValidationError), so every user
 * with calendar sync on got a 500. `whereClause: any` hid it from typecheck,
 * and the other ics test mocks findMany, so it never validated the clause.
 *
 * This walks the captured `where` and checks every field it names is a real
 * Task column or relation, using the generated client's own field list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const findUnique = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderSettings: { findUnique },
    task: { findMany },
  },
}))
vi.mock('@/lib/brand/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  capabilityGate: () => null,
}))

const { GET } = await import('@/app/api/calendar/tasks.ics/route')

const LOGICAL = new Set(['AND', 'OR', 'NOT'])
const taskModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Task')!
const TASK_FIELDS = new Set(taskModel.fields.map(f => f.name))

/** Field names used directly on Task (not inside a field's filter object). */
function taskFieldsIn(where: unknown, out: string[] = []): string[] {
  if (Array.isArray(where)) {
    where.forEach(w => taskFieldsIn(w, out))
    return out
  }
  if (!where || typeof where !== 'object') return out
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL.has(key)) taskFieldsIn(value, out)
    else out.push(key)
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue({ user: { id: 'user-1' } })
  findMany.mockResolvedValue([])
})

describe('calendar feed names only real Task fields (AWTD-1317)', () => {
  it.each(['all', 'with_due_times'])('sync type %s', async calendarSyncType => {
    findUnique.mockResolvedValue({ userId: 'user-1', enableCalendarSync: true, calendarSyncType })

    const response = await GET(new Request('https://example.test/api/calendar/tasks.ics') as never)

    expect(response.status).toBe(200)
    const fields = taskFieldsIn(findMany.mock.calls[0][0].where)
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.filter(f => !TASK_FIELDS.has(f))).toEqual([])
  })
})
