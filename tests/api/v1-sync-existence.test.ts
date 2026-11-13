/**
 * AWTD-1515: POST /api/v1/sync/existence — batch "which cached ids are gone?".
 *
 * "Missing" must mean exactly what the per-row GET means. So these tests do
 * not assert how the query is spelled: they evaluate the route's `where`
 * against fixture rows (every field checked against the Prisma schema), and
 * for each case also run the per-row GET over the SAME rows and require the
 * two to agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { unknownWhereFields } from '../utils/prisma-where'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    taskList: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn() }
})

vi.mock('@/lib/favorites', () => ({
  hydrateSingleListFavorite: vi.fn(async (list: Record<string, unknown>) => {
    list.isFavorite = false
    list.favoriteOrder = null
  }),
  toggleFavorite: vi.fn(),
}))
vi.mock('@/lib/list-view-preferences', () => ({
  hydrateSingleListViewPreferences: vi.fn(),
  saveListViewPreferences: vi.fn(),
  splitListViewPreferences: vi.fn(),
}))
vi.mock('@/lib/default-assignee', () => ({ resolveDefaultAssignees: vi.fn(async () => new Map()) }))
vi.mock('@/lib/backends/list-wire', () => ({ loadListBackendInfo: vi.fn(async () => new Map()) }))
vi.mock('@/lib/lists/v1-list-shape', () => ({
  V1_LIST_READ_INCLUDE: {},
  shapeV1List: (list: { id: string }) => ({ id: list.id }),
}))
vi.mock('@/lib/tasks/v1-task-shape', () => ({
  loadV1Task: vi.fn(async (id: string) => (TASKS.some(t => t.id === id) ? { id } : null)),
}))
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))

import { POST } from '@/app/api/v1/sync/existence/route'
import { GET as getTask } from '@/app/api/v1/tasks/[id]/route'
import { GET as getList } from '@/app/api/v1/lists/[id]/route'
import { V1_EXISTENCE_MAX_IDS } from '@/lib/sync/v1-existence'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, taskWriteAccessWhere } from '@/lib/api-auth-middleware'
import { canUserEditTasks } from '@/lib/list-permissions'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

// ── Fixture rows ──────────────────────────────────────────────────────

const ME = 'user-me'
const OTHER = 'user-other'

type ProjectRow = { ownerId: string; members: { userId: string }[]; lists: ListRow[] }
type ListRow = {
  id: string; ownerId: string; privacy: string; listMembers: { userId: string }[]
  // The fields the project and label branches of the visibility clause read (AWTD-1519).
  listType: string; remoteNodeId: string | null; project: ProjectRow | null; tasks: TaskRow[]
}
type TaskRow = { id: string; creatorId: string; assigneeId: string | null; lists: ListRow[] }

const list = (row: Pick<ListRow, 'id' | 'ownerId' | 'privacy' | 'listMembers'> & Partial<ListRow>): ListRow =>
  ({ listType: 'regular', remoteNodeId: null, project: null, tasks: [], ...row })

const myList = list({ id: 'list-mine', ownerId: ME, privacy: 'PRIVATE', listMembers: [] })
const sharedWithMe = list({ id: 'list-shared', ownerId: OTHER, privacy: 'SHARED', listMembers: [{ userId: ME }] })
// I was a member of this one and have been removed.
const removedFrom = list({ id: 'list-removed', ownerId: OTHER, privacy: 'SHARED', listMembers: [{ userId: 'user-third' }] })
const othersPrivate = list({ id: 'list-private', ownerId: OTHER, privacy: 'PRIVATE', listMembers: [] })
const publicList = list({ id: 'list-public', ownerId: OTHER, privacy: 'PUBLIC', listMembers: [] })
// AWTD-1519: I reach this list only through the project it belongs to.
const projectList = list({
  id: 'list-project', ownerId: OTHER, privacy: 'PRIVATE', listMembers: [],
  project: { ownerId: OTHER, members: [{ userId: ME }], lists: [] },
})
// A project I am not in: still private to me.
const othersProjectList = list({
  id: 'list-others-project', ownerId: OTHER, privacy: 'PRIVATE', listMembers: [],
  project: { ownerId: OTHER, members: [{ userId: 'user-third' }], lists: [] },
})
// A board's status list, which I reach through being a member of a sibling domain list
// on the same project (task 142e4dd9). Not a project member.
const statusColumn = list({
  id: 'list-status', ownerId: OTHER, privacy: 'PRIVATE', listMembers: [], listType: 'status',
  project: { ownerId: OTHER, members: [], lists: [list({ id: 'list-sibling', ownerId: OTHER, privacy: 'PRIVATE', listMembers: [{ userId: ME }] })] },
})
const LISTS = [myList, sharedWithMe, removedFrom, othersPrivate, publicList, projectList, othersProjectList, statusColumn]

const TASKS: TaskRow[] = [
  { id: 'task-mine', creatorId: ME, assigneeId: null, lists: [myList] },
  { id: 'task-shared', creatorId: OTHER, assigneeId: null, lists: [sharedWithMe] },
  { id: 'task-hidden', creatorId: OTHER, assigneeId: null, lists: [othersPrivate] },
  { id: 'task-assigned', creatorId: OTHER, assigneeId: ME, lists: [othersPrivate] },
  { id: 'task-public', creatorId: OTHER, assigneeId: null, lists: [publicList] },
  // AWTD-1523: reachable only through the project its list belongs to.
  { id: 'task-project', creatorId: OTHER, assigneeId: null, lists: [projectList] },
  { id: 'task-others-project', creatorId: OTHER, assigneeId: null, lists: [othersProjectList] },
  { id: 'task-status', creatorId: OTHER, assigneeId: null, lists: [statusColumn] },
]

/** Just enough of Prisma's where semantics: equality, `in`, `some`, OR / AND. */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Record<string, any>[]).some(c => matches(row, c))
    if (key === 'AND') return (value as Record<string, any>[]).every(c => matches(row, c))
    if (value && typeof value === 'object' && 'in' in value) return (value.in as unknown[]).includes(row[key])
    if (value && typeof value === 'object' && 'not' in value) {
      if (!(key in row)) throw new Error(`fixture row has no field ${key}`)
      return row[key] !== value.not
    }
    if (value && typeof value === 'object' && 'some' in value) {
      if (!Array.isArray(row[key])) throw new Error(`fixture row has no relation ${key}`)
      return (row[key] as Record<string, any>[]).some(r => matches(r, value.some))
    }
    // A to-one relation (`project: { ownerId }`): a null relation matches nothing.
    if (value && typeof value === 'object' && key in row && (row[key] === null || (typeof row[key] === 'object' && !Array.isArray(row[key])))) {
      return row[key] !== null && matches(row[key], value)
    }
    if (value && typeof value === 'object') throw new Error(`unhandled condition on ${key}`)
    if (!(key in row)) throw new Error(`fixture row has no field ${key}`)
    return row[key] === value
  })
}

function rowsFor<T extends { id: string }>(model: 'Task' | 'TaskList', rows: T[], where: Record<string, any>): T[] {
  const bad = unknownWhereFields(model, where)
  if (bad.length) throw new Error(`${model}: unknown where field(s) ${bad.join(', ')}`)
  return rows.filter(r => matches(r, where))
}

function signIn(scopes: string[] = ['tasks:read', 'lists:read']) {
  mockAuth.mockResolvedValue({
    userId: ME, source: 'oauth', scopes, isAIAgent: false,
    user: { id: ME, email: 'me@example.com', name: 'Me', isAIAgent: false },
  } as never)
}

function existence(body: unknown) {
  return POST(new NextRequest('http://localhost/api/v1/sync/existence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

const rowGet = (path: string) => new NextRequest(`http://localhost/api/v1/${path}`)

beforeEach(() => {
  vi.clearAllMocks()
  signIn()
  mockPrisma.task.findMany.mockImplementation((async (args: { where: Record<string, any> }) =>
    rowsFor('Task', TASKS, args.where).map(t => ({ id: t.id }))) as never)
  mockPrisma.taskList.findMany.mockImplementation((async (args: { where: Record<string, any> }) =>
    rowsFor('TaskList', LISTS, args.where).map(l => ({ id: l.id }))) as never)
  mockPrisma.task.findFirst.mockImplementation((async (args: { where: Record<string, any> }) =>
    rowsFor('Task', TASKS, args.where)[0] ?? null) as never)
  mockPrisma.taskList.findFirst.mockImplementation((async (args: { where: Record<string, any> }) =>
    rowsFor('TaskList', LISTS, args.where)[0] ?? null) as never)
})

describe('POST /api/v1/sync/existence (AWTD-1515)', () => {
  it('AWTD-1515: a task the caller cannot see comes back missing', async () => {
    const res = await existence({ taskIds: ['task-hidden'] })
    expect(res.status).toBe(200)
    expect((await res.json()).missingTaskIds).toEqual(['task-hidden'])
  })

  it('AWTD-1515: a deleted or nonexistent task id comes back missing', async () => {
    const res = await existence({ taskIds: ['task-deleted-long-ago'] })
    expect((await res.json()).missingTaskIds).toEqual(['task-deleted-long-ago'])
  })

  it('AWTD-1515: visible tasks are not missing — creator, list member, assignee, public list', async () => {
    const res = await existence({ taskIds: ['task-mine', 'task-shared', 'task-assigned', 'task-public'] })
    const body = await res.json()
    expect(body).toEqual({
      missingTaskIds: [],
      missingListIds: [],
      maxIds: V1_EXISTENCE_MAX_IDS,
      meta: { apiVersion: 'v1', authSource: 'oauth' },
    })
  })

  it('AWTD-1515: a list the caller was removed from comes back missing; lists still shared are not', async () => {
    const res = await existence({ listIds: ['list-removed', 'list-shared', 'list-mine', 'list-public', 'list-private'] })
    expect((await res.json()).missingListIds).toEqual(['list-removed', 'list-private'])
  })

  it('AWTD-1519: a list I see only through its project is not missing; another project\'s list is', async () => {
    const res = await existence({ listIds: ['list-project', 'list-others-project'] })
    expect((await res.json()).missingListIds).toEqual(['list-others-project'])
  })

  it('AWTD-1519: GET /api/v1/lists/:id serves a project member the project\'s list', async () => {
    const id = 'list-project'
    expect((await getList(rowGet(`lists/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200)
  })

  it('AWTD-1523: a task on a list I see only through its project is not missing; another project\'s is', async () => {
    const res = await existence({ taskIds: ['task-project', 'task-others-project'] })
    expect((await res.json()).missingTaskIds).toEqual(['task-others-project'])
  })

  it('AWTD-1523: GET /api/v1/tasks/:id serves a project member a task on the project\'s list', async () => {
    const id = 'task-project'
    expect((await getTask(rowGet(`tasks/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200)
  })

  it('AWTD-1515: answers in one query per kind, in request order, duplicates once', async () => {
    const res = await existence({ taskIds: ['task-hidden', 'gone', 'task-mine', 'gone'], listIds: ['list-removed'] })
    expect(await res.json()).toMatchObject({ missingTaskIds: ['task-hidden', 'gone'], missingListIds: ['list-removed'] })
    expect(mockPrisma.task.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.taskList.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.task.findFirst).not.toHaveBeenCalled()
  })

  it('AWTD-1515: over the cap is a 400 that states the cap', async () => {
    const taskIds = Array.from({ length: V1_EXISTENCE_MAX_IDS + 1 }, (_, i) => `task-${i}`)
    const res = await existence({ taskIds })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(String(V1_EXISTENCE_MAX_IDS))
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled()
  })

  it('AWTD-1515: exactly at the cap is accepted', async () => {
    const listIds = Array.from({ length: V1_EXISTENCE_MAX_IDS }, (_, i) => `list-${i}`)
    expect((await existence({ listIds })).status).toBe(200)
  })

  it.each([
    ['not an object', [1, 2]],
    ['taskIds not an array', { taskIds: 'task-mine' }],
    ['a non-string id', { listIds: ['list-mine', 7] }],
    ['an empty id', { taskIds: [''] }],
    ['not JSON', '{nope'],
  ])('AWTD-1515: a malformed body (%s) is a 400', async (_label, body) => {
    expect((await existence(body)).status).toBe(400)
  })

  it('AWTD-1515: each kind needs the read scope its per-row GET needs', async () => {
    signIn(['tasks:read'])
    expect((await existence({ taskIds: ['task-mine'] })).status).toBe(200)
    expect((await existence({ listIds: ['list-mine'] })).status).toBe(403)

    signIn(['lists:read'])
    expect((await existence({ listIds: ['list-mine'] })).status).toBe(200)
    expect((await existence({ taskIds: ['task-mine'] })).status).toBe(403)

    signIn(['comments:write'])
    expect((await existence({})).status).toBe(403)
  })

  it('AWTD-1515: missing ⇔ the per-row GET answers 403/404, for every fixture row', async () => {
    const ids = { taskIds: [...TASKS.map(t => t.id), 'gone'], listIds: [...LISTS.map(l => l.id), 'gone'] }
    const body = await (await existence(ids)).json()

    for (const id of ids.taskIds) {
      const status = (await getTask(rowGet(`tasks/${id}`), { params: Promise.resolve({ id }) })).status
      expect([403, 404, 410].includes(status), `task ${id}: GET ${status}`).toBe(body.missingTaskIds.includes(id))
    }
    for (const id of ids.listIds) {
      const status = (await getList(rowGet(`lists/${id}`), { params: Promise.resolve({ id }) })).status
      expect([403, 404, 410].includes(status), `list ${id}: GET ${status}`).toBe(body.missingListIds.includes(id))
    }
  })
})

/**
 * AWTD-1523, the write half. Jon chose (2026-11-13) that a project member may edit and
 * delete tasks on the project's lists, which is what `getUserRoleInList` already grants
 * them ("member" on every list of the project, and on a board's status lists for anyone
 * shared on a sibling list). The write check (`requireTaskAccess`: PUT, DELETE, blockers,
 * claim) said owner/member only, so the app offered an edit the API then refused.
 */
describe('task write access follows the list role (AWTD-1523)', () => {
  const writable = () => rowsFor('Task', TASKS, taskWriteAccessWhere(ME)).map(t => t.id)

  it('AWTD-1523: a project member may write a task on the project\'s list; not another project\'s', () => {
    expect(writable()).toContain('task-project')
    expect(writable()).not.toContain('task-others-project')
  })

  it('AWTD-1523: a member of a sibling list may write a task on the board\'s status list', () => {
    expect(writable()).toContain('task-status')
  })

  it('AWTD-1523: a public list still grants nobody write access', () => {
    expect(writable()).not.toContain('task-public')
    expect(JSON.stringify(taskWriteAccessWhere(ME))).not.toContain('PUBLIC')
  })

  it('AWTD-1523: for every task I neither created nor am assigned, write ⇔ the list role edits', () => {
    const user = { id: ME }
    for (const task of TASKS.filter(t => t.creatorId !== ME && t.assigneeId !== ME)) {
      const canEdit = task.lists.some(l => canUserEditTasks(user, {
        ...l,
        listMembers: l.listMembers.map(m => ({ ...m, role: 'member' })),
        project: l.project && {
          ...l.project,
          members: l.project.members.map(m => ({ ...m, role: 'member' })),
        },
      }))
      expect(writable().includes(task.id), `task ${task.id}`).toBe(canEdit)
    }
  })
})
