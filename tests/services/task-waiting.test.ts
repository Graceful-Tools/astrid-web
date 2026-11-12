/**
 * The Waiting rules on the server's task writes (Jon, 2026-11-12): services/task-waiting.ts.
 *
 * A move into Waiting with no condition is a 422 WAITING_NEEDS_CONDITION — except from a native
 * app while WAITING_ENFORCE_NATIVE=lenient; entering clears the assignee unless kept; a condition
 * supplied in the same write (date, waitOnTaskId) counts; an ordinary edit is not asked about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const blockers = vi.hoisted(() => ({ rows: [] as Array<{ blockingTaskId: string; blockingTask: { completed: boolean } }> }))
const checkBlockerCandidate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: { taskDependency: { findMany: vi.fn(async () => blockers.rows) } },
}))
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (value: string) => value) }))
vi.mock('@/services/task-dependency.service', () => ({ checkBlockerCandidate }))

const NOW = new Date('2026-11-12T12:00:00.000Z')
const FUTURE = new Date('2026-11-20T09:00:00.000Z')
const ready = { id: 't1', statusRole: 'ready', dueDateTime: null, isAllDay: false, assigneeId: 'agent', completed: false }

beforeEach(() => {
  blockers.rows = []
  checkBlockerCandidate.mockResolvedValue({ ok: true, completed: false })
})
afterEach(() => vi.unstubAllEnvs())

async function update(over: Partial<Parameters<typeof import('@/services/task-waiting').resolveWaitingForUpdate>[0]>) {
  const { resolveWaitingForUpdate } = await import('@/services/task-waiting')
  return resolveWaitingForUpdate({
    existingTask: ready,
    data: { statusRole: 'waiting' },
    requestedCompleted: undefined,
    request: {},
    actorId: 'u1',
    now: NOW,
    ...over,
  })
}

describe('a move into Waiting (update)', () => {
  it('with no condition is refused with a sentence a person can act on', async () => {
    const result = await update({})
    expect(result).toMatchObject({ ok: false, status: 422, code: 'WAITING_NEEDS_CONDITION' })
    expect(!result.ok && result.error).toMatch(/future date or a task to wait on/)
  })

  it('with a future date in the same write enters and clears the assignee', async () => {
    const result = await update({ data: { statusRole: 'waiting', dueDateTime: FUTURE } })
    expect(result).toEqual({ ok: true, data: { statusRole: 'waiting', assigneeId: null, assigneeIds: [] }, attachBlockerId: undefined, transition: 'enter' })
  })

  it('keeps the assignee when asked', async () => {
    const result = await update({ data: { statusRole: 'waiting', dueDateTime: FUTURE }, request: { keepAssignee: true } })
    expect(result).toMatchObject({ ok: true, data: { statusRole: 'waiting' }, transition: 'enter' })
    expect(result.ok && 'assigneeId' in result.data).toBe(false)
  })

  it('with waitOnTaskId enters and hands the blocker back to attach', async () => {
    const result = await update({ request: { waitOnTaskId: 'b1' } })
    expect(result).toMatchObject({ ok: true, attachBlockerId: 'b1', transition: 'enter' })
  })

  it('refuses a waitOnTaskId the cycle check refuses', async () => {
    checkBlockerCandidate.mockResolvedValue({ ok: false, status: 409, error: 'cycle', reason: 'dependency_cycle' })
    expect(await update({ request: { waitOnTaskId: 'b1' } })).toMatchObject({ ok: false, status: 409, code: 'dependency_cycle' })
  })

  it('counts an open blocker already attached', async () => {
    blockers.rows = [{ blockingTaskId: 'b1', blockingTask: { completed: false } }]
    expect(await update({})).toMatchObject({ ok: true, transition: 'enter' })
  })

  it('from a native app is let through while lenient, still unassigned', async () => {
    const result = await update({ platform: 'iOS-app' })
    expect(result).toEqual({ ok: true, data: { statusRole: 'waiting', assigneeId: null, assigneeIds: [] }, attachBlockerId: undefined, transition: 'native-lenient' })
  })

  it('from a native app is refused once WAITING_ENFORCE_NATIVE=enforce', async () => {
    vi.stubEnv('WAITING_ENFORCE_NATIVE', 'enforce')
    expect(await update({ platform: 'android-app' })).toMatchObject({ ok: false, status: 422 })
  })

  it('from MCP / the plain API is always refused', async () => {
    expect(await update({ platform: 'API-other' })).toMatchObject({ ok: false, status: 422 })
  })
})

describe('edits that are not a move', () => {
  it('a title edit that echoes the same role and date is not asked about', async () => {
    const waiting = { ...ready, statusRole: 'waiting', assigneeId: null }
    expect(await update({ existingTask: waiting, data: { statusRole: 'waiting', dueDateTime: null, title: 'x' } })).toMatchObject({ ok: true, data: {}, transition: 'none' })
  })

  it('a date change on a Ready task is not the rules\' business', async () => {
    expect(await update({ data: { dueDateTime: FUTURE } })).toMatchObject({ ok: true, data: {}, transition: 'none' })
  })

  it('clearing the date of a dated Waiting task wakes it to Ready', async () => {
    const waiting = { ...ready, statusRole: 'waiting', dueDateTime: FUTURE, assigneeId: null }
    expect(await update({ existingTask: waiting, data: { dueDateTime: null } })).toMatchObject({ ok: true, data: { statusRole: 'ready' }, transition: 'wake' })
  })

  it('completing a task is completion\'s business', async () => {
    expect(await update({ requestedCompleted: true })).toMatchObject({ ok: true, data: {}, transition: 'none' })
  })

  it('reopening a task whose remembered lane is Waiting with no condition lands in Inbox', async () => {
    const done = { ...ready, statusRole: null, completed: true }
    expect(await update({ existingTask: done, requestedCompleted: false })).toMatchObject({ ok: true, data: { statusRole: null }, transition: 'inbox' })
  })
})

describe('a create into Waiting', () => {
  async function create(over: Partial<Parameters<typeof import('@/services/task-waiting').resolveWaitingForCreate>[0]>) {
    const { resolveWaitingForCreate } = await import('@/services/task-waiting')
    return resolveWaitingForCreate({ statusRole: 'waiting', dueDateTime: null, assigneeId: 'jon', completed: false, request: {}, actorId: 'u1', now: NOW, ...over })
  }

  it('with no condition is refused', async () => {
    expect(await create({})).toMatchObject({ ok: false, status: 422, code: 'WAITING_NEEDS_CONDITION' })
  })

  it('with a future date is born Waiting, unassigned', async () => {
    expect(await create({ dueDateTime: FUTURE })).toMatchObject({ ok: true, data: { statusRole: 'waiting', assigneeId: null }, transition: 'enter' })
  })

  it('waiting on a task, keeping the assignee', async () => {
    const result = await create({ request: { waitOnTaskId: 'b1', keepAssignee: true } })
    expect(result).toMatchObject({ ok: true, data: { statusRole: 'waiting' }, attachBlockerId: 'b1' })
    expect(result.ok && 'assigneeId' in result.data).toBe(false)
  })

  it('in any other lane is not asked about', async () => {
    expect(await create({ statusRole: 'ready' })).toMatchObject({ ok: true, data: {}, transition: 'none' })
  })
})
