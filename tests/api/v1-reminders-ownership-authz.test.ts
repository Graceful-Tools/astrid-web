/**
 * POST /api/v1/reminders/:id/dismiss and /snooze — authorization (AWTD-1341).
 *
 * A reminder belongs to one user. Another signed-in user (with the right
 * scope) must get 403 from both routes and the reminder must be untouched;
 * an unknown id is 404. Runs the real lib/reminder-dismiss and
 * lib/reminder-snooze against a mocked prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const caller = vi.hoisted(() => ({ userId: 'owner-1' }))
const reminderFindUnique = vi.hoisted(() => vi.fn())
const reminderWrites = vi.hoisted(() => ({
  update: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}))
const taskUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: caller.userId, scopes: ['user:write'], source: 'oauth' }, ctx),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderQueue: { findUnique: reminderFindUnique, ...reminderWrites },
    task: { update: taskUpdate },
  },
}))

import { POST as dismiss } from '@/app/api/v1/reminders/[id]/dismiss/route'
import { POST as snooze } from '@/app/api/v1/reminders/[id]/snooze/route'

const REMINDER = {
  id: 'rem-1',
  userId: 'owner-1',
  taskId: 'task-1',
  status: 'pending',
  scheduledFor: new Date('2026-10-01T00:00:00Z'),
  retryCount: 0,
  data: {},
}

const ctx = (id = 'rem-1') => ({ params: Promise.resolve({ id }) }) as never
const req = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/v1/reminders/rem-1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function expectUntouched() {
  for (const fn of Object.values(reminderWrites)) expect(fn).not.toHaveBeenCalled()
  expect(taskUpdate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  caller.userId = 'owner-1'
  reminderFindUnique.mockImplementation(async ({ where }) => (where.id === 'rem-1' ? REMINDER : null))
  reminderWrites.update.mockImplementation(async ({ data }) => ({ ...REMINDER, ...data }))
  reminderWrites.count.mockResolvedValue(0)
  reminderWrites.findMany.mockResolvedValue([REMINDER])
})

describe('POST /api/v1/reminders/:id/dismiss authorization (AWTD-1341)', () => {
  it("AWTD-1341: another user cannot dismiss someone else's reminder (403)", async () => {
    caller.userId = 'intruder-1'
    expect((await dismiss(req('dismiss', {}), ctx())).status).toBe(403)
    expectUntouched()
  })

  it("AWTD-1341: another user cannot dismissAll on someone else's task reminders (403)", async () => {
    caller.userId = 'intruder-1'
    expect((await dismiss(req('dismiss', { dismissAll: true }), ctx())).status).toBe(403)
    expectUntouched()
  })

  it('AWTD-1341: an unknown reminder is 404', async () => {
    expect((await dismiss(req('dismiss', {}), ctx('rem-missing'))).status).toBe(404)
    expectUntouched()
  })

  it('AWTD-1341: the owner can dismiss (control)', async () => {
    const res = await dismiss(req('dismiss', {}), ctx())
    expect(res.status).toBe(200)
    expect(reminderWrites.delete).toHaveBeenCalledWith({ where: { id: 'rem-1' } })
  })
})

describe('POST /api/v1/reminders/:id/snooze authorization (AWTD-1341)', () => {
  it("AWTD-1341: another user cannot snooze someone else's reminder (403)", async () => {
    caller.userId = 'intruder-1'
    expect((await snooze(req('snooze', { minutes: 10 }), ctx())).status).toBe(403)
    expectUntouched()
  })

  it('AWTD-1341: an unknown reminder is 404', async () => {
    expect((await snooze(req('snooze', { minutes: 10 }), ctx('rem-missing'))).status).toBe(404)
    expectUntouched()
  })

  it('AWTD-1341: the owner can snooze (control)', async () => {
    const res = await snooze(req('snooze', { minutes: 10 }), ctx())
    expect(res.status).toBe(200)
    expect(reminderWrites.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rem-1' } }))
  })
})
