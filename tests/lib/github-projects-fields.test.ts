/**
 * AWTD-1117 (P6a): a GitHub project's own fields, and each item's values for
 * them (spec §9.4.1). Pure rules, from the REAL recorded schema where it has
 * the shape and hand-written values where the test project has none.
 *
 * Pinned:
 *   - only the five field types Astrid can show are kept; GitHub's built-ins
 *     (Title, Assignees, Labels, …) are not fields here;
 *   - Status, Priority and due are marked mapped, and never stored as values;
 *   - a value for a field the board has not met asks for a schema refresh —
 *     but the Title value every item carries does not;
 *   - values are compared, so an echo writes nothing, and a field cleared on
 *     GitHub is cleared here unless the read was cut short.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIELD_VALUES_PER_ITEM,
  normaliseFields,
  planFieldSchema,
  planFieldValues,
  remoteFieldValues,
  scalarOf,
  valueColumns,
  type KnownField,
} from '@/lib/github/projects/fields'
import type { ProjectSchema } from '@/lib/github/projects/bind'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const schema = load('project-schema.json').data.node as ProjectSchema
const binding = load('binding-graceful-fools.json')
const page = load('project-items-page.json').data.node.items.nodes as RemoteProjectItem[]

const STATUS = 'PVTSSF_lADOFEb-HM4BmXS2zhlApMc'
const TITLE = 'PVTF_lADOFEb-HM4BmXS2zhlApMU'

const known = (fields: Array<Partial<KnownField> & { id: string; remoteId: string; dataType: string }>) =>
  new Map(fields.map(f => [f.remoteId, { mappedTo: null, options: null, iterations: null, ...f } as KnownField]))

const item = (nodes: unknown[]): RemoteProjectItem =>
  ({ ...page[0], fieldValues: { nodes } }) as unknown as RemoteProjectItem

describe('normaliseFields (AWTD-1117)', () => {
  const fields = normaliseFields(schema.fields.nodes, binding)

  it('keeps only the field types Astrid can show: GitHub’s built-ins are not fields', () => {
    expect(fields.map(f => f.dataType).every(t => ['text', 'number', 'date', 'single_select', 'iteration'].includes(t))).toBe(true)
    expect(fields.find(f => f.remoteId === TITLE)).toBeUndefined()
    expect(fields.find(f => f.name === 'Assignees')).toBeUndefined()
    expect(fields.find(f => f.name === 'Size')).toMatchObject({ dataType: 'single_select', mappedTo: null })
  })

  it('marks the bound Status field as mapped, and keeps its options', () => {
    const status = fields.find(f => f.remoteId === STATUS)!
    expect(status.mappedTo).toBe('status')
    expect(status.options?.map(o => o.name)).toEqual(['Todo', 'In progress', 'Done'])
  })

  it('numbers the kept fields in GitHub’s order', () => {
    expect(fields.map(f => f.position)).toEqual(fields.map((_, index) => index))
  })

  it('an iteration field carries its iterations, completed ones included', () => {
    const [sprint] = normaliseFields(
      [
        {
          __typename: 'ProjectV2IterationField',
          id: 'PVTIF_1',
          name: 'Sprint',
          dataType: 'ITERATION',
          configuration: {
            iterations: [{ id: 'it-2', title: 'Sprint 2', startDate: '2026-10-12', duration: 14 }],
            completedIterations: [{ id: 'it-1', title: 'Sprint 1', startDate: '2026-09-28', duration: 14 }],
          },
        },
      ],
      binding,
    )
    expect(sprint).toMatchObject({ dataType: 'iteration', options: null })
    expect(sprint.iterations?.map(i => i.id)).toEqual(['it-1', 'it-2'])
  })

  it('priority and due are mapped when the binding names them', () => {
    const mapped = normaliseFields(
      [
        { __typename: 'ProjectV2SingleSelectField', id: 'P', name: 'Priority', dataType: 'SINGLE_SELECT', options: [{ id: 'a', name: 'High' }] },
        { __typename: 'ProjectV2Field', id: 'D', name: 'Due', dataType: 'DATE' },
        { __typename: 'ProjectV2Field', id: 'E', name: 'Estimate', dataType: 'NUMBER' },
      ],
      { statusFieldId: null, priorityFieldId: 'P', dueFieldId: 'D' },
    )
    // Estimate has no Task column (P4a), so it stays an ordinary field.
    expect(mapped.map(f => f.mappedTo)).toEqual(['priority', 'due', null])
  })
})

describe('planFieldSchema (AWTD-1117)', () => {
  const remote = normaliseFields(schema.fields.nodes, binding)
  const heldOf = (fields: typeof remote) => fields.map((f, i) => ({ ...f, id: `field-${i}` }))

  it('a board meeting its fields for the first time creates them all', () => {
    expect(planFieldSchema(remote, [])).toEqual({ create: remote, update: [], remove: [] })
  })

  it('a schema that already agrees writes nothing', () => {
    expect(planFieldSchema(remote, heldOf(remote))).toEqual({ create: [], update: [], remove: [] })
  })

  it('a renamed field is updated in place, and one GitHub deleted is removed', () => {
    const held = heldOf(remote)
    held[0] = { ...held[0], name: 'Old name' }
    const gone = { ...held[0], id: 'field-gone', remoteId: 'PVTF_deleted' }
    const plan = planFieldSchema(remote, [...held, gone])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([{ id: 'field-0', data: remote[0] }])
    expect(plan.remove).toEqual(['field-gone'])
  })
})

describe('remoteFieldValues (AWTD-1117)', () => {
  const fields = known([
    { id: 'f-status', remoteId: STATUS, dataType: 'single_select', mappedTo: 'status' },
    { id: 'f-size', remoteId: 'SIZE', dataType: 'single_select', options: [{ id: 'opt-s' }] },
    { id: 'f-notes', remoteId: 'NOTES', dataType: 'text' },
    { id: 'f-points', remoteId: 'POINTS', dataType: 'number' },
    { id: 'f-start', remoteId: 'START', dataType: 'date' },
    { id: 'f-sprint', remoteId: 'SPRINT', dataType: 'iteration', iterations: [{ id: 'it-1' }] },
  ])

  it('reads one compact value per field, and never a mapped one', () => {
    const read = remoteFieldValues(
      item([
        { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'f75ad846', field: { id: STATUS } },
        { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'opt-s', field: { id: 'SIZE' } },
        { __typename: 'ProjectV2ItemFieldTextValue', text: 'call first', field: { id: 'NOTES' } },
        { __typename: 'ProjectV2ItemFieldNumberValue', number: 3, field: { id: 'POINTS' } },
        { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-10-20', field: { id: 'START' } },
        { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'it-1', field: { id: 'SPRINT' } },
      ]),
      fields,
    )
    expect(Object.fromEntries(read.values)).toEqual({
      'f-size': 'opt-s',
      'f-notes': 'call first',
      'f-points': 3,
      'f-start': '2026-10-20',
      'f-sprint': 'it-1',
    })
    expect(read.unknown).toBe(false)
    expect(read.complete).toBe(true)
  })

  it('the recorded page: Title and Status values are not custom values, and ask for no refresh', () => {
    const read = remoteFieldValues(page[0], fields)
    expect(read.values.size).toBe(0)
    expect(read.unknown).toBe(false)
  })

  it('a value for a field the board has not met asks for a schema refresh', () => {
    const read = remoteFieldValues(
      item([{ __typename: 'ProjectV2ItemFieldNumberValue', number: 5, field: { id: 'NEW', dataType: 'NUMBER' } }]),
      fields,
    )
    expect(read.values.size).toBe(0)
    expect(read.unknown).toBe(true)
  })

  it('GitHub’s own Title value is never "unknown"', () => {
    const read = remoteFieldValues(
      item([{ __typename: 'ProjectV2ItemFieldTextValue', text: 'A title', field: { id: TITLE, dataType: 'TITLE' } }]),
      fields,
    )
    expect(read.unknown).toBe(false)
  })

  it('an option or iteration added on GitHub since the last refresh is kept, and asks for one', () => {
    const read = remoteFieldValues(
      item([
        { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'opt-xl', field: { id: 'SIZE' } },
        { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'it-9', field: { id: 'SPRINT' } },
      ]),
      fields,
    )
    expect(Object.fromEntries(read.values)).toEqual({ 'f-size': 'opt-xl', 'f-sprint': 'it-9' })
    expect(read.unknown).toBe(true)
  })

  it('a read that filled its page may have been cut short', () => {
    const nodes = Array.from({ length: FIELD_VALUES_PER_ITEM }, () => ({ __typename: 'ProjectV2ItemFieldRepositoryValue' }))
    expect(remoteFieldValues(item(nodes), fields).complete).toBe(false)
  })
})

describe('planFieldValues (AWTD-1117)', () => {
  const remote = (values: Record<string, string | number>, complete = true) => ({
    values: new Map(Object.entries(values)),
    unknown: false,
    complete,
  })

  it('sets what differs, clears what GitHub no longer has, and leaves what agrees', () => {
    const plan = planFieldValues(remote({ a: 'x', b: 2 }), new Map<string, string | number>([['a', 'x'], ['b', 1], ['c', 'old']]))
    expect(plan).toEqual({ set: [['b', 2]], clear: ['c'] })
  })

  it('an echo of what is held writes nothing', () => {
    expect(planFieldValues(remote({ a: 'x' }), new Map([['a', 'x']]))).toEqual({ set: [], clear: [] })
  })

  it('a read cut short adds and changes, but never clears', () => {
    expect(planFieldValues(remote({ a: 'y' }, false), new Map([['a', 'x'], ['c', 'old']]))).toEqual({ set: [['a', 'y']], clear: [] })
  })
})

describe('valueColumns / scalarOf (AWTD-1117)', () => {
  it.each([
    ['text', 'hello'],
    ['number', 2.5],
    ['date', '2026-10-20'],
    ['single_select', 'opt-1'],
    ['iteration', 'it-1'],
  ] as const)('a %s value survives the round trip through its column', (dataType, value) => {
    const columns = valueColumns(dataType, value)
    expect(Object.values(columns).filter(v => v !== null)).toHaveLength(1)
    expect(scalarOf(columns)).toEqual(value)
  })
})
