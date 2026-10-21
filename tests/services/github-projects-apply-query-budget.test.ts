/**
 * AWTD-1297: applying ONE changed item stays within §13.3's "≤ 4 queries per
 * item event" — the budget AWTD-1154 measured at 3 and P6a/P6c pushed to 10.
 *
 * tests/services/github-projects-service.test.ts mocks the field and iteration
 * passes, so it could not see them; this runs the REAL replica writer, field
 * pass and iteration pass over a mocked Prisma that counts SQL statements the
 * way Prisma issues them:
 *   - every model call is one statement;
 *   - every to-many relation in a `select` is one more (the implicit
 *     Task↔TaskList many-to-many is two: the join table, then the lists);
 *   - a to-one relation whose foreign key is null costs nothing (the live run
 *     shows no User or parent-Task read for an unassigned, parentless issue);
 *   - `_count` rides in the parent statement.
 *
 * The live counterpart is `npm run test:live:github-projects`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `rows[name]` is what a read answers: set per test, since mockReturnValue would replace the counting. */
const counter = vi.hoisted(() => ({ statements: 0, log: [] as string[], rows: {} as Record<string, unknown[]> }))

const db = vi.hoisted(() => {
  const TO_ONE = new Set(['parentTask', 'assignee', 'project'])
  const M2M = new Set(['lists', 'tasks'])
  function relationStatements(select: unknown): number {
    if (!select || typeof select !== 'object') return 0
    let n = 0
    for (const [key, value] of Object.entries(select as Record<string, unknown>)) {
      if (key === '_count' || value === true || value === false || TO_ONE.has(key)) continue
      if (typeof value === 'object') n += (M2M.has(key) ? 2 : 1) + relationStatements((value as { select?: unknown }).select)
    }
    return n
  }
  const op = (name: string) =>
    vi.fn((args?: unknown) => {
      const statements = 1 + relationStatements((args as { select?: unknown } | undefined)?.select)
      counter.statements += statements
      counter.log.push(`${name} (${statements})`)
      return name.endsWith('findMany') ? Promise.resolve(counter.rows[name] ?? []) : { op: name, args }
    })
  return {
    op,
    task: { findMany: op('task.findMany'), update: op('task.update'), updateMany: op('task.updateMany') },
    gitHubProjectItem: { findMany: op('item.findMany'), createMany: op('item.createMany'), upsert: op('item.upsert'), update: op('item.update') },
    taskDependency: { createMany: op('dependency.createMany'), deleteMany: op('dependency.deleteMany'), findMany: op('dependency.findMany') },
    user: { findMany: op('user.findMany') },
    taskList: { findMany: op('list.findMany'), createMany: op('list.createMany'), update: op('list.update') },
    projectField: { findMany: op('field.findMany') },
    taskFieldValue: {
      findMany: op('value.findMany'),
      createMany: op('value.createMany'),
      update: op('value.update'),
      deleteMany: op('value.deleteMany'),
    },
    $transaction: vi.fn(async (writes: unknown) => writes),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/services/task-bulk-create', () => ({ createTasksInBulk: vi.fn() }))
vi.mock('@/lib/redis', () => ({ RedisCache: { invalidate: { userTasks: vi.fn(async () => {}), userLists: vi.fn(async () => {}) } } }))

import { applyProjectItems, type BoundBoard } from '@/services/github-projects.service'
import { normaliseItem, type RemoteProjectItem } from '@/lib/github/projects/apply'
import { LIST_TYPE_LABEL, LIST_TYPE_MILESTONE } from '@/lib/list-flavors'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const recorded = load('project-items-page.json').data.node.items.nodes as RemoteProjectItem[]
const binding = load('binding-graceful-fools.json')

const TITLE_FIELD = 'PVTF_lADOFEb-HM4BmXS2zhlApMU'
const MAGIC = { id: 'f-magic', remoteId: 'PVTF_magic', name: 'magic', dataType: 'text', mappedTo: null, options: null, iterations: null, position: 20 }
const SPRINT = {
  id: 'f-sprint',
  remoteId: 'PVTIF_sprint',
  name: 'Iteration',
  dataType: 'iteration',
  mappedTo: null,
  options: null,
  iterations: [{ id: 'it-41', title: 'Sprint 41', startDate: '2026-10-19', duration: 14 }],
  position: 16,
}

/** A label as GitHub answers it, and the label-flavor list the import left behind. */
const BUG_LABEL = { id: 'LA_bug', name: 'bug', color: 'd73a4a' }
const BUG_LIST = {
  id: 'list-label-bug',
  remoteNodeId: BUG_LABEL.id,
  listType: LIST_TYPE_LABEL,
  name: BUG_LABEL.name,
  color: `#${BUG_LABEL.color}`,
  description: 'Graceful-Fools/wordlesolver',
}

/** A milestone as GitHub answers it, and its list. */
const V12_MILESTONE = { id: 'MI_v12', title: 'v1.2', dueOn: null }
const V12_LIST = {
  id: 'list-milestone-v12',
  remoteNodeId: V12_MILESTONE.id,
  listType: LIST_TYPE_MILESTONE,
  name: V12_MILESTONE.title,
  color: null,
  description: 'Graceful-Fools/wordlesolver',
}

/** Issue #1 as hydration returns it LIVE: every field reference carries its dataType. */
function issueOne(
  extra: RemoteProjectItem['fieldValues']['nodes'] = [],
  content: Partial<NonNullable<RemoteProjectItem['content']>> = {},
): RemoteProjectItem {
  const item = recorded[0]
  return {
    ...item,
    content: { ...item.content!, title: `${item.content!.title} (edited)`, ...content } as RemoteProjectItem['content'],
    fieldValues: {
      nodes: [
        { __typename: 'ProjectV2ItemFieldRepositoryValue' },
        { __typename: 'ProjectV2ItemFieldTextValue', text: item.content!.title, field: { id: TITLE_FIELD, dataType: 'TITLE' } },
        {
          __typename: 'ProjectV2ItemFieldSingleSelectValue',
          optionId: 'f75ad846',
          name: 'Todo',
          field: { id: binding.statusFieldId, dataType: 'SINGLE_SELECT' },
        },
        ...extra,
      ] as RemoteProjectItem['fieldValues']['nodes'],
    },
  }
}

/** The replica the import left behind, before the title edit. */
function replicaOf(item: RemoteProjectItem, held: { values: number; lists: Array<{ id: string; remoteNodeId: string; listType: string }> }) {
  const n = normaliseItem(recorded[0], binding)!
  return {
    id: 'task-1',
    remoteNodeId: n.remoteNodeId,
    ...n.task,
    identifier: n.identifier,
    remoteKind: n.remoteKind,
    remoteVersion: item.content!.updatedAt,
    parentTaskId: null,
    parentTask: null,
    assigneeId: null,
    assigneeIds: [],
    assignee: null,
    blockedBy: [],
    lists: held.lists,
    _count: { blockedBy: 0, lists: held.lists.length, fieldValues: held.values },
  }
}

const board = (fields: unknown[]): BoundBoard =>
  ({ projectId: 'proj-1', listId: 'list-1', ownerId: 'user-1', projectNodeId: 'PVT_kwDOFEb-HM4BmXS2', binding, fields }) as BoundBoard

beforeEach(() => {
  vi.clearAllMocks()
  counter.statements = 0
  counter.log = []
  counter.rows = {}
})

describe('applying one changed item costs ≤ 4 statements (AWTD-1297, §13.3)', () => {
  it('a title-only edit on an item that carries only built-in and mapped values', async () => {
    const item = issueOne()
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 0, lists: [] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]

    expect(await applyProjectItems(board([MAGIC, SPRINT]), [item])).toMatchObject({ updated: 1 })

    expect(counter.log).toContain('task.update (1)')
    expect(counter.statements, counter.log.join(', ')).toBeLessThanOrEqual(4)
  })

  it('a title-only edit on a task that holds a custom field value, unchanged', async () => {
    const item = issueOne([
      { __typename: 'ProjectV2ItemFieldTextValue', text: 'abracadabra', field: { id: MAGIC.remoteId, dataType: 'TEXT' } },
    ] as unknown as RemoteProjectItem['fieldValues']['nodes'])
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 1, lists: [] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]
    counter.rows['value.findMany'] = [
      { taskId: 'task-1', fieldId: MAGIC.id, text: 'abracadabra', number: null, date: null, optionId: null, iterationId: null },
    ]

    expect(await applyProjectItems(board([MAGIC, SPRINT]), [item])).toMatchObject({ updated: 1 })

    // Nothing but the title changed, so the title is the only write. The board
    // already carries its field schema, and the iteration pass reuses the
    // values the field pass read rather than reading both again.
    expect(counter.log.filter(entry => !/findMany/.test(entry))).toEqual(['task.update (1)'])
    expect(db.projectField.findMany).not.toHaveBeenCalled()
    expect(db.taskFieldValue.findMany).toHaveBeenCalledTimes(1)
    expect(counter.statements, counter.log.join(', ')).toBeLessThanOrEqual(4)
  })
})

/**
 * RED for AWTD-1315: an item that holds labels or a milestone was still over.
 *
 * AWTD-1297 brought a title-only edit to 3 statements by COUNTING what a replica
 * holds and reading only what is held. A task on a mirrored list defeats both
 * halves of that:
 *
 *   - the held read is `task.findMany` with an implicit many-to-many in its
 *     select, and Prisma reads one of those in two steps — Task, then the join
 *     table, then TaskList. Three statements for one task's labels.
 *   - and then each apply pass looks its own flavor up AGAIN by `remoteNodeId`,
 *     to check for drift and to get list ids, even when every label on the item
 *     is already held and nothing about it has changed.
 *
 * So a labelled issue with an edited title cost about 7. The live smoke fixtures
 * carry no labels, so `npm run test:live:github-projects` cannot see this at
 * all — which is why it is pinned here.
 */
describe('a held label or milestone does not blow the budget (AWTD-1315)', () => {
  it('AWTD-1315: a title-only edit on a task that holds a label, unchanged', async () => {
    const item = issueOne([], { labels: { totalCount: 1, nodes: [BUG_LABEL] } } as never)
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 0, lists: [BUG_LIST] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]
    counter.rows['list.findMany'] = [BUG_LIST]

    expect(await applyProjectItems(board([MAGIC, SPRINT]), [item])).toMatchObject({ updated: 1 })

    // The label is already held and has not drifted, so the title is the only write.
    expect(counter.log.filter(entry => !/findMany/.test(entry))).toEqual(['task.update (1)'])
    expect(counter.statements, counter.log.join(', ')).toBeLessThanOrEqual(4)
  })

  it('AWTD-1315: a title-only edit on a task that holds a label AND a milestone', async () => {
    const item = issueOne([], {
      labels: { totalCount: 1, nodes: [BUG_LABEL] },
      milestone: V12_MILESTONE,
    } as never)
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 0, lists: [BUG_LIST, V12_LIST] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]
    counter.rows['list.findMany'] = [BUG_LIST, V12_LIST]

    expect(await applyProjectItems(board([MAGIC, SPRINT]), [item])).toMatchObject({ updated: 1 })

    expect(counter.log.filter(entry => !/findMany/.test(entry))).toEqual(['task.update (1)'])
    expect(counter.statements, counter.log.join(', ')).toBeLessThanOrEqual(4)
  })

  it('AWTD-1315: a label whose NAME drifted is still read and corrected', async () => {
    // The saving must come from skipping a lookup that would have told us
    // nothing, not from stopping looking. A renamed label still has to land.
    const renamed = { ...BUG_LABEL, name: 'defect' }
    const item = issueOne([], { labels: { totalCount: 1, nodes: [renamed] } } as never)
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 0, lists: [BUG_LIST] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]
    counter.rows['list.findMany'] = [BUG_LIST]

    await applyProjectItems(board([MAGIC, SPRINT]), [item])

    expect(counter.log.filter(entry => !/findMany/.test(entry))).toContain('list.update (1)')
  })

  it('AWTD-1315: a label the task does NOT hold is still looked up and joined', async () => {
    // A new label cannot be served from the held rows, so the lookup has to
    // happen — and the task has to join the list.
    const item = issueOne([], { labels: { totalCount: 1, nodes: [BUG_LABEL] } } as never)
    counter.rows['item.findMany'] = [{ itemNodeId: item.id, archived: false }]
    counter.rows['task.findMany'] = [replicaOf(item, { values: 0, lists: [] })]
    counter.rows['field.findMany'] = [MAGIC, SPRINT]
    counter.rows['list.findMany'] = [BUG_LIST]

    await applyProjectItems(board([MAGIC, SPRINT]), [item])

    expect(db.taskList.findMany).toHaveBeenCalled()
    expect(counter.log.filter(entry => !/findMany/.test(entry))).toContain('task.update (1)')
  })
})
