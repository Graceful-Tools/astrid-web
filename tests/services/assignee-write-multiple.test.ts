/**
 * The update path's assignee gate with several assignees (AWTD-1190, spec §9.5).
 *
 * The list arithmetic is tests/lib/task-assignees.test.ts. Pinned here is what
 * the gate adds: whether the list supports several at all, that every person
 * ADDED is authorised and nobody else is, and that an agent is only ever first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn() },
  taskList: { findMany: vi.fn(), count: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const backend = vi.hoisted(() => ({ kind: 'local' as 'local' | 'github_project' }))
vi.mock('@/lib/backends/resolve', () => ({
  GITHUB_PROJECT_BACKEND: 'github_project',
  taskBackendFor: vi.fn(async () => ({ kind: backend.kind })),
}))

import { authorizeAssigneeWrite } from '@/services/assignee-authorization'

const ACTOR = 'actor'
const write = (
  intent: { assigneeId?: string | null; assigneeIds?: unknown },
  held: string[] = [],
) =>
  authorizeAssigneeWrite({
    intent,
    actorId: ACTOR,
    task: { id: 't1', creatorId: ACTOR, assigneeId: held[0] ?? null, assigneeIds: held },
    targetListIds: ['list-1'],
    requireListMembership: false,
  })
const authorised = () => db.user.findUnique.mock.calls.map(([args]) => (args as { where: { id: string } }).where.id)

beforeEach(() => {
  vi.clearAllMocks()
  backend.kind = 'github_project'
  db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, isAIAgent: false }))
  db.user.count.mockResolvedValue(0)
})

describe('authorizeAssigneeWrite (AWTD-1190)', () => {
  it('a classic list refuses a second assignee, before anyone is looked up', async () => {
    backend.kind = 'local'
    expect(await write({ assigneeIds: ['a', 'b'] }, ['a'])).toEqual({
      ok: false,
      status: 400,
      error: 'multiple_assignees_not_supported',
    })
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('a classic list still takes one assignee either way it is spelled', async () => {
    backend.kind = 'local'
    expect(await write({ assigneeId: 'b' }, ['a'])).toEqual({ ok: true, assigneeIds: ['b'] })
    expect(await write({ assigneeIds: ['b'] }, ['a'])).toEqual({ ok: true, assigneeIds: ['b'] })
  })

  it('on a GitHub board an old client setting assigneeId replaces only the first entry', async () => {
    expect(await write({ assigneeId: 'z' }, ['a', 'b'])).toEqual({ ok: true, assigneeIds: ['z', 'b'] })
    expect(authorised()).toEqual(['z'])
  })

  it('on a GitHub board an old client clearing assigneeId unassigns only the first', async () => {
    expect(await write({ assigneeId: null }, ['a', 'b'])).toEqual({ ok: true, assigneeIds: ['b'] })
    expect(authorised()).toEqual([])
  })

  it('everyone added is authorised, and nobody who was already assigned', async () => {
    expect(await write({ assigneeIds: ['a', 'b', 'c'] }, ['a'])).toEqual({ ok: true, assigneeIds: ['a', 'b', 'c'] })
    expect(authorised()).toEqual(['b', 'c'])
  })

  it('adding yourself needs no permission', async () => {
    expect(await write({ assigneeIds: ['a', ACTOR] }, ['a'])).toEqual({ ok: true, assigneeIds: ['a', ACTOR] })
    expect(authorised()).toEqual([])
  })

  it('an agent is only ever the first assignee: further down it would never run', async () => {
    db.user.count.mockResolvedValue(1)
    expect(await write({ assigneeIds: ['a', ACTOR] }, ['a'])).toEqual({
      ok: false,
      status: 400,
      error: 'agent_must_be_first_assignee',
    })
    expect(db.user.count).toHaveBeenCalledWith({ where: { id: { in: [ACTOR] }, isAIAgent: true } })
  })

  it('one assignee asks nothing about agents further down', async () => {
    await write({ assigneeId: 'b' }, ['a'])
    expect(db.user.count).not.toHaveBeenCalled()
  })
})
