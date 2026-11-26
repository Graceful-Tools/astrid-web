/**
 * ADEV-279: entering the Pending results column needs an experiment or a verification to wait on
 * (P1), unassigns the task and remembers the holder (P2), and an ordinary edit costs nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  taskExperiment: { findMany: vi.fn(), updateMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { resolveResultsForUpdate } from '@/services/task-results'

const NOW = new Date('2026-11-26T12:00:00Z')
const link = (over: Record<string, unknown> = {}) => ({ id: 'x1', kind: 'experiment', state: 'running', verdict: null, decideBy: null, fetchedAt: null, ...over })
const task = (over: Record<string, unknown> = {}) => ({ id: 't1', statusRole: 'doing', assigneeId: 'agent', completed: false, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.taskExperiment.findMany.mockResolvedValue([])
  prismaMock.taskExperiment.updateMany.mockResolvedValue({ count: 1 })
})

describe('moving a task into Pending results (ADEV-279)', () => {
  it('P1: is refused with RESULTS_NEEDS_CONDITION when nothing is being waited on', async () => {
    const out = await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'results' }, requestedCompleted: undefined, now: NOW })
    expect(out).toMatchObject({ ok: false, status: 422, code: 'RESULTS_NEEDS_CONDITION' })
  })

  it('P1: an ended verification, or a concluded experiment, is nothing to wait for', async () => {
    prismaMock.taskExperiment.findMany.mockResolvedValue([
      link({ kind: 'verification', decideBy: new Date(NOW.getTime() - 1000) }),
      link({ id: 'x2', state: 'concluded', verdict: 'improving' }),
    ])
    expect(await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'results' }, requestedCompleted: undefined, now: NOW })).toMatchObject({ ok: false })
  })

  it('P1/P2: an open experiment lets it in, unassigns the task and remembers the holder on the open link', async () => {
    prismaMock.taskExperiment.findMany.mockResolvedValue([link(), link({ id: 'x2', state: 'concluded', verdict: 'improving' })])
    const out = await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'results' }, requestedCompleted: undefined, now: NOW })
    expect(out).toEqual({ ok: true, data: { statusRole: 'results', assigneeId: null, assigneeIds: [] } })
    expect(prismaMock.taskExperiment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['x1'] } }, data: { returnAssigneeId: 'agent' } })
  })

  it('a verification with its deadline ahead lets it in; keepAssignee keeps the assignee', async () => {
    prismaMock.taskExperiment.findMany.mockResolvedValue([link({ kind: 'verification', decideBy: new Date(NOW.getTime() + 86_400_000) })])
    const out = await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'results' }, requestedCompleted: undefined, keepAssignee: true, now: NOW })
    expect(out).toEqual({ ok: true, data: { statusRole: 'results' } })
    expect(prismaMock.taskExperiment.updateMany).not.toHaveBeenCalled()
  })

  it('P6: leaving by hand is always allowed, and an ordinary edit asks nothing', async () => {
    const leave = await resolveResultsForUpdate({ existingTask: task({ statusRole: 'results' }), data: { statusRole: 'doing' }, requestedCompleted: undefined, now: NOW })
    expect(leave).toEqual({ ok: true, data: {} })
    const same = await resolveResultsForUpdate({ existingTask: task({ statusRole: 'results' }), data: { statusRole: 'results', title: 'x' }, requestedCompleted: undefined, now: NOW })
    expect(same).toEqual({ ok: true, data: {} })
    const other = await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'waiting' }, requestedCompleted: undefined, now: NOW })
    expect(other).toEqual({ ok: true, data: {} })
    expect(prismaMock.taskExperiment.findMany).not.toHaveBeenCalled()
  })

  it('completing the task is Done’s business, not the lane’s', async () => {
    const out = await resolveResultsForUpdate({ existingTask: task(), data: { statusRole: 'results' }, requestedCompleted: true, now: NOW })
    expect(out).toEqual({ ok: true, data: {} })
    expect(prismaMock.taskExperiment.findMany).not.toHaveBeenCalled()
  })
})
