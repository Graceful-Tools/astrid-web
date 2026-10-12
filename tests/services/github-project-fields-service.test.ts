/**
 * AWTD-1117 (P6a): the replica's copy of a GitHub project's fields and of each
 * task's values for them (spec §9.4.1, §9.4.2 "schema drift").
 *
 * Pinned:
 *   - the schema is written by value: a refresh that finds nothing new writes nothing;
 *   - a page of items costs one field read and one value read, however many items;
 *   - new values go in as ONE createMany; a changed one is an update; a cleared
 *     one is deleted; and every task whose values changed has updatedAt bumped,
 *     so the change rides the existing ?updatedSince= delta (§9.4.3);
 *   - a value for a field the board has not met refreshes the schema once;
 *   - an archived item's values leave with it;
 *   - a board with no fields costs one read and no writes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  projectField: {
    findMany: vi.fn(),
    createMany: vi.fn((args: unknown) => ({ op: 'field.createMany', args })),
    update: vi.fn((args: unknown) => ({ op: 'field.update', args })),
    deleteMany: vi.fn((args: unknown) => ({ op: 'field.deleteMany', args })),
  },
  taskFieldValue: {
    findMany: vi.fn(),
    createMany: vi.fn((args: unknown) => ({ op: 'value.createMany', args })),
    update: vi.fn((args: unknown) => ({ op: 'value.update', args })),
    deleteMany: vi.fn((args: unknown) => ({ op: 'value.deleteMany', args })),
  },
  task: { updateMany: vi.fn((args: unknown) => ({ op: 'task.updateMany', args })) },
  $transaction: vi.fn(async (writes: unknown) => writes),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { applyFieldValues, syncProjectFields, type FieldBoard } from '@/services/github-project-fields.service'
import { normaliseFields } from '@/lib/github/projects/fields'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import type { GraphqlClient } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const schemaResponse = load('project-schema.json').data
const page = load('project-items-page.json').data.node.items.nodes as RemoteProjectItem[]

const board: FieldBoard = {
  projectId: 'proj-1',
  projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
  binding: load('binding-graceful-fools.json'),
}

const clientReturning = (data: unknown) => ({ query: vi.fn(async () => data) }) as unknown as GraphqlClient & { query: ReturnType<typeof vi.fn> }

const FIELDS = [
  { id: 'f-size', remoteId: 'SIZE', name: 'Size', dataType: 'single_select', mappedTo: null, options: [{ id: 'opt-s', name: 'S' }], iterations: null, position: 0 },
  { id: 'f-points', remoteId: 'POINTS', name: 'Points', dataType: 'number', mappedTo: null, options: null, iterations: null, position: 1 },
  { id: 'f-start', remoteId: 'START', name: 'Start', dataType: 'date', mappedTo: null, options: null, iterations: null, position: 2 },
]

const item = (id: string, nodes: unknown[], isArchived = false): RemoteProjectItem =>
  ({ ...page[0], id, isArchived, fieldValues: { nodes } }) as unknown as RemoteProjectItem

const size = (optionId: string) => ({ __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId, field: { id: 'SIZE' } })
const points = (number: number) => ({ __typename: 'ProjectV2ItemFieldNumberValue', number, field: { id: 'POINTS' } })
const start = (date: string) => ({ __typename: 'ProjectV2ItemFieldDateValue', date, field: { id: 'START' } })

const transacted = () => (db.$transaction.mock.calls[0]?.[0] ?? []) as Array<{ op: string; args: any }>

beforeEach(() => {
  vi.clearAllMocks()
  db.projectField.findMany.mockResolvedValue(FIELDS)
  db.taskFieldValue.findMany.mockResolvedValue([])
})

describe('syncProjectFields (AWTD-1117)', () => {
  it('a board meeting its project’s fields stores the ones Astrid shows, in one write', async () => {
    db.projectField.findMany.mockResolvedValue([])
    const changed = await syncProjectFields(board, clientReturning(schemaResponse))

    expect(changed).toBe(true)
    const [write] = transacted()
    expect(write.op).toBe('field.createMany')
    const names = write.args.data.map((row: { name: string }) => row.name)
    expect(names).toContain('Status')
    expect(names).toContain('Size')
    expect(names).not.toContain('Title')
    expect(write.args.data.every((row: { projectId: string }) => row.projectId === 'proj-1')).toBe(true)
    expect(write.args.data.find((row: { name: string }) => row.name === 'Status').mappedTo).toBe('status')
  })

  it('a refresh that finds nothing new writes nothing', async () => {
    const remote = normaliseFields(schemaResponse.node.fields.nodes, board.binding)
    db.projectField.findMany.mockResolvedValue(remote.map((field, i) => ({ ...field, id: `f-${i}` })))

    expect(await syncProjectFields(board, clientReturning(schemaResponse))).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('a field deleted on GitHub goes, and one that became mapped drops its stored values', async () => {
    const remote = normaliseFields(schemaResponse.node.fields.nodes, board.binding)
    const held = remote.map((field, i) => ({ ...field, id: `f-${i}` }))
    const status = held.find(field => field.mappedTo === 'status')!
    status.mappedTo = null
    db.projectField.findMany.mockResolvedValue([...held, { ...held[0], id: 'f-gone', remoteId: 'PVTF_gone' }])

    await syncProjectFields(board, clientReturning(schemaResponse))

    const ops = transacted()
    expect(ops).toContainEqual({ op: 'field.deleteMany', args: { where: { id: { in: ['f-gone'] } } } })
    expect(ops.find(op => op.op === 'field.update')?.args).toMatchObject({ where: { id: status.id }, data: { mappedTo: 'status' } })
    expect(ops).toContainEqual({ op: 'value.deleteMany', args: { where: { fieldId: { in: [status.id] } } } })
  })

  it('a project GitHub will not show keeps the fields already held', async () => {
    expect(await syncProjectFields(board, clientReturning({ node: null }))).toBe(false)
    expect(db.projectField.findMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('applyFieldValues (AWTD-1117)', () => {
  it('a page’s new values go in as one createMany, and its tasks are touched for the delta', async () => {
    const changed = await applyFieldValues(board, [
      { item: item('i1', [size('opt-s'), points(3)]), taskId: 't1' },
      { item: item('i2', [start('2026-10-20')]), taskId: 't2' },
    ])

    expect(changed).toBe(true)
    expect(db.projectField.findMany).toHaveBeenCalledTimes(1)
    expect(db.taskFieldValue.findMany).toHaveBeenCalledTimes(1)
    const ops = transacted()
    expect(ops.map(op => op.op)).toEqual(['value.createMany', 'task.updateMany'])
    expect(ops[0].args.data).toEqual([
      { taskId: 't1', fieldId: 'f-size', projectId: 'proj-1', text: null, number: null, date: null, optionId: 'opt-s', iterationId: null },
      { taskId: 't1', fieldId: 'f-points', projectId: 'proj-1', text: null, number: 3, date: null, optionId: null, iterationId: null },
      { taskId: 't2', fieldId: 'f-start', projectId: 'proj-1', text: null, number: null, date: new Date('2026-10-20T00:00:00.000Z'), optionId: null, iterationId: null },
    ])
    expect(ops[1].args.where).toEqual({ id: { in: ['t1', 't2'] } })
    expect(ops[1].args.data.updatedAt).toBeInstanceOf(Date)
  })

  it('values that already agree write nothing', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([
      { taskId: 't1', fieldId: 'f-size', text: null, number: null, date: null, optionId: 'opt-s', iterationId: null },
      { taskId: 't1', fieldId: 'f-start', text: null, number: null, date: new Date('2026-10-20T00:00:00.000Z'), optionId: null, iterationId: null },
    ])

    expect(await applyFieldValues(board, [{ item: item('i1', [size('opt-s'), start('2026-10-20')]), taskId: 't1' }])).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('a changed value is updated, and one cleared on GitHub is deleted', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([
      { taskId: 't1', fieldId: 'f-points', text: null, number: 3, date: null, optionId: null, iterationId: null },
      { taskId: 't1', fieldId: 'f-size', text: null, number: null, date: null, optionId: 'opt-s', iterationId: null },
    ])

    await applyFieldValues(board, [{ item: item('i1', [points(5)]), taskId: 't1' }])

    const ops = transacted()
    expect(ops).toContainEqual({
      op: 'value.update',
      args: {
        where: { taskId_fieldId: { taskId: 't1', fieldId: 'f-points' } },
        data: { text: null, number: 5, date: null, optionId: null, iterationId: null },
      },
    })
    expect(ops).toContainEqual({ op: 'value.deleteMany', args: { where: { taskId: 't1', fieldId: { in: ['f-size'] } } } })
    expect(ops.at(-1)?.args.where).toEqual({ id: { in: ['t1'] } })
  })

  it('an archived item’s values leave with it', async () => {
    db.taskFieldValue.findMany.mockResolvedValue([
      { taskId: 't1', fieldId: 'f-points', text: null, number: 3, date: null, optionId: null, iterationId: null },
    ])

    await applyFieldValues(board, [{ item: item('i1', [points(3)], true), taskId: 't1' }])

    expect(transacted()).toContainEqual({ op: 'value.deleteMany', args: { where: { taskId: 't1', fieldId: { in: ['f-points'] } } } })
  })

  it('a value for a field the board has not met refreshes the schema once, then stores it', async () => {
    const fresh = { id: 'f-new', remoteId: 'NEW', name: 'Effort', dataType: 'number', mappedTo: null, options: null, iterations: null, position: 3 }
    db.projectField.findMany
      .mockResolvedValueOnce(FIELDS) // the page's field read
      .mockResolvedValueOnce(FIELDS) // the refresh's own read of what is held
      .mockResolvedValueOnce([...FIELDS, fresh]) // re-read after the refresh
    const client = clientReturning({
      node: {
        ...schemaResponse.node,
        fields: { nodes: [{ __typename: 'ProjectV2Field', id: 'NEW', name: 'Effort', dataType: 'NUMBER' }] },
      },
    })
    const effort = { __typename: 'ProjectV2ItemFieldNumberValue', number: 8, field: { id: 'NEW', dataType: 'NUMBER' } }

    await applyFieldValues(board, [{ item: item('i1', [effort]), taskId: 't1' }, { item: item('i2', [effort]), taskId: 't2' }], client)

    expect(client.query).toHaveBeenCalledTimes(1)
    const values = db.taskFieldValue.createMany.mock.calls[0][0] as { data: Array<{ fieldId: string; number: number }> }
    expect(values.data.map(row => [row.fieldId, row.number])).toEqual([['f-new', 8], ['f-new', 8]])
  })

  it('without a client an unknown field is skipped, not fetched', async () => {
    const effort = { __typename: 'ProjectV2ItemFieldNumberValue', number: 8, field: { id: 'NEW', dataType: 'NUMBER' } }
    expect(await applyFieldValues(board, [{ item: item('i1', [effort]), taskId: 't1' }])).toBe(false)
  })

  it('a board with no fields costs one read and no writes', async () => {
    db.projectField.findMany.mockResolvedValue([])

    expect(await applyFieldValues(board, [{ item: page[0], taskId: 't1' }])).toBe(false)
    expect(db.taskFieldValue.findMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('no items, no reads', async () => {
    expect(await applyFieldValues(board, [])).toBe(false)
    expect(db.projectField.findMany).not.toHaveBeenCalled()
  })
})
