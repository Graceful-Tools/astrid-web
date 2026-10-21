/**
 * Iteration values → iteration lists (AWTD-1230, P6c-3b).
 *
 * The executor half of lib/github/projects/iterations.ts. It reads what P6a
 * already stored (`TaskFieldValue.iterationId`) rather than the item, so it
 * inherits P6a's rules: a cut-short read clears nothing, an archived item's
 * values are gone and its iteration lists with them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  projectField: { findMany: vi.fn() },
  taskFieldValue: { findMany: vi.fn() },
  taskList: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn((args: unknown) => ({ op: 'list.update', args })),
  },
  task: { update: vi.fn((args: unknown) => ({ op: 'task.update', args })) },
  $transaction: vi.fn(async (ops: unknown) => ops),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const redis = vi.hoisted(() => ({ userLists: vi.fn(async () => {}) }))
vi.mock('@/lib/redis', () => ({ RedisCache: { invalidate: redis } }))

import { applyIterationLists } from '@/services/github-iteration-lists.service'
import { ITERATION_LIST_COLOR } from '@/lib/github/projects/iterations'

const board = { projectId: 'proj-1', ownerId: 'user-1' }
const sprintField = {
  id: 'pf-sprint',
  remoteId: 'PVTIF_sprint',
  name: 'Sprint',
  iterations: [
    { id: 'it-41', title: 'Sprint 41', startDate: '2026-10-05', duration: 14 },
    { id: 'it-42', title: 'Sprint 42', startDate: '2026-10-19', duration: 14 },
  ],
}
const list41 = { id: 'list-41', remoteNodeId: 'PVTIF_sprint:it-41', name: 'Sprint 41', description: 'Sprint · 2026-10-05 – 2026-10-18' }
const list42 = { id: 'list-42', remoteNodeId: 'PVTIF_sprint:it-42', name: 'Sprint 42', description: 'Sprint · 2026-10-19 – 2026-11-01' }

/**
 * A held iteration list, as the replica read now hands it over (AWTD-1315).
 *
 * `listType`, `name`, `color` and `description` are part of the row because the
 * pass checks drift against what it already holds instead of re-reading the list
 * by node id. A fixture without them is not what production passes, and the pass
 * would read it as a list renamed to `undefined`.
 */
const heldIteration = (list: { id: string; remoteNodeId: string; name: string; description: string }) => ({
  id: list.id,
  remoteNodeId: list.remoteNodeId,
  listType: 'iteration',
  name: list.name,
  color: ITERATION_LIST_COLOR,
  description: list.description,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.projectField.findMany.mockResolvedValue([sprintField])
  db.taskFieldValue.findMany.mockResolvedValue([])
  db.taskList.findMany.mockResolvedValue([])
})

describe('applyIterationLists (AWTD-1230)', () => {
  it('an iteration nobody has seen becomes an iteration list, and the task joins it', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([{ taskId: 't1', fieldId: 'pf-sprint', iterationId: 'it-41' }])
    db.taskList.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([list41])

    expect(await applyIterationLists(board, [{ taskId: 't1', held: [] }])).toBe(true)

    expect(db.taskList.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: 'Sprint 41',
          color: '#0891b2',
          description: 'Sprint · 2026-10-05 – 2026-10-18',
          ownerId: 'user-1',
          listType: 'iteration',
          remoteNodeId: 'PVTIF_sprint:it-41',
        },
      ],
      skipDuplicates: true,
    })
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { lists: { connect: [{ id: 'list-41' }] } } })
    expect(redis.userLists).toHaveBeenCalledWith('user-1')
  })

  it('MOVING sprint leaves the old iteration list', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([{ taskId: 't1', fieldId: 'pf-sprint', iterationId: 'it-42' }])
    db.taskList.findMany.mockResolvedValue([list42])

    await applyIterationLists(board, [{ taskId: 't1', held: [heldIteration(list41)] }])

    expect(db.taskList.createMany).not.toHaveBeenCalled()
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { lists: { connect: [{ id: 'list-42' }], disconnect: [{ id: 'list-41' }] } },
    })
  })

  it('a cleared value (or an archived item, whose values P6a removed) leaves the list', async () => {
    await applyIterationLists(board, [{ taskId: 't1', held: [heldIteration(list41)] }])
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { lists: { disconnect: [{ id: 'list-41' }] } } })
  })

  it('an iteration that already agrees writes nothing', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([{ taskId: 't1', fieldId: 'pf-sprint', iterationId: 'it-41' }])
    db.taskList.findMany.mockResolvedValue([list41])

    expect(await applyIterationLists(board, [{ taskId: 't1', held: [heldIteration(list41)] }])).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('an iteration re-dated on GitHub updates its list', async () => {
    db.projectField.findMany.mockResolvedValue([{ ...sprintField, iterations: [{ ...sprintField.iterations[0], duration: 7 }] }])
    db.taskFieldValue.findMany.mockResolvedValue([{ taskId: 't1', fieldId: 'pf-sprint', iterationId: 'it-41' }])
    db.taskList.findMany.mockResolvedValue([list41])

    await applyIterationLists(board, [{ taskId: 't1', held: [heldIteration(list41)] }])

    expect(db.taskList.update).toHaveBeenCalledWith({ where: { id: 'list-41' }, data: { description: 'Sprint · 2026-10-05 – 2026-10-11' } })
  })

  it('a board with no iteration field and no held iteration list reads nothing more', async () => {
    db.projectField.findMany.mockResolvedValue([])
    expect(await applyIterationLists(board, [{ taskId: 't1', held: [] }])).toBe(false)
    expect(db.taskFieldValue.findMany).not.toHaveBeenCalled()
  })

  it('given the field pass’s result, reads neither the schema nor the values again (AWTD-1297)', async () => {
    db.taskList.findMany.mockResolvedValue([list42])
    const known = {
      fields: [{ ...sprintField, dataType: 'iteration', mappedTo: null }],
      values: new Map([['t1', new Map([['pf-sprint', 'it-42']])]]),
    }

    expect(await applyIterationLists(board, [{ taskId: 't1', held: [heldIteration(list41)] }], known)).toBe(true)

    expect(db.projectField.findMany).not.toHaveBeenCalled()
    expect(db.taskFieldValue.findMany).not.toHaveBeenCalled()
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { lists: { connect: [{ id: 'list-42' }], disconnect: [{ id: 'list-41' }] } },
    })
  })

  it('a field pass that needed no schema means nothing to read when nothing is held', async () => {
    expect(await applyIterationLists(board, [{ taskId: 't1', held: [] }], { fields: null, values: new Map() })).toBe(false)
    expect(db.projectField.findMany).not.toHaveBeenCalled()
    expect(db.taskList.findMany).not.toHaveBeenCalled()
  })
})
