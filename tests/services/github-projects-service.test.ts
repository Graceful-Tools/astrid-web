/**
 * AWTD-1151 (P4c): the replica writer — a hydrated page of GitHub items
 * becomes tasks on the bound board (spec §8.7, §13.3).
 *
 * Driven by the REAL recorded page (tests/fixtures/github/graphql). Pinned:
 *   - new items are created through createTasksInBulk in fromRemote mode, with
 *     GitHub's identifiers, shared (not private), keyed by content node id;
 *   - each page costs two reads, however many items it holds (no N+1);
 *   - an item already mirrored and unchanged writes nothing;
 *   - a changed one is patched by value; an archived one leaves the list;
 *   - binding twice is a 409, not a second board.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn(), update: vi.fn((args: unknown) => ({ op: 'task.update', args })) },
  gitHubProjectItem: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn((args: unknown) => ({ op: 'item.upsert', args })),
    update: vi.fn((args: unknown) => ({ op: 'item.update', args })),
  },
  taskDependency: {
    createMany: vi.fn((args: unknown) => ({ op: 'dependency.createMany', args })),
    deleteMany: vi.fn((args: unknown) => ({ op: 'dependency.deleteMany', args })),
  },
  gitHubProjectBinding: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  project: { create: vi.fn() },
  taskList: { create: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const bulk = vi.hoisted(() => ({ createTasksInBulk: vi.fn() }))
vi.mock('@/services/task-bulk-create', () => bulk)

vi.mock('@/lib/redis', () => ({ RedisCache: { invalidate: { userTasks: vi.fn(async () => {}) } } }))

import { applyProjectItems, bindGitHubProject, type BoundBoard } from '@/services/github-projects.service'
import { normaliseItem, type RemoteProjectItem } from '@/lib/github/projects/apply'
import { proposeBinding, type ProjectSchema } from '@/lib/github/projects/bind'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const items = load('project-items-page.json').data.node.items.nodes as RemoteProjectItem[]
const schema = load('project-schema.json').data.node as ProjectSchema

const board: BoundBoard = {
  projectId: 'proj-1',
  listId: 'list-1',
  ownerId: 'user-1',
  binding: load('binding-graceful-fools.json'),
}

/** The replica row an item would have left behind. */
function replicaOf(item: RemoteProjectItem, id: string) {
  const n = normaliseItem(item, board.binding)!
  return {
    id,
    remoteNodeId: n.remoteNodeId,
    ...n.task,
    identifier: n.identifier,
    remoteKind: n.remoteKind,
    remoteVersion: n.remoteVersion,
    parentTaskId: null as string | null,
    parentTask: null as { remoteNodeId: string | null } | null,
    blockedBy: [] as Array<{ blockingTaskId: string }>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.task.findMany.mockResolvedValue([])
  db.gitHubProjectItem.findMany.mockResolvedValue([])
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: typeof db) => unknown)(db) : arg))
  bulk.createTasksInBulk.mockImplementation(async ({ tasks }: { tasks: Array<{ data: { remoteNodeId: string } }> }) => ({
    tasks: tasks.map((t, i) => ({ id: `new-${i}`, remoteNodeId: t.data.remoteNodeId })),
  }))
})

describe('applyProjectItems (AWTD-1151)', () => {
  it('imports a fresh page: three tasks created from GitHub, each with its membership', async () => {
    const summary = await applyProjectItems(board, items)

    expect(summary).toEqual({ created: 3, updated: 0, left: 0, unchanged: 0, skipped: 0 })
    const call = bulk.createTasksInBulk.mock.calls[0][0]
    expect(call).toMatchObject({ actorId: 'user-1', fromRemote: { source: 'GitHub' } })
    expect(call.tasks[0]).toMatchObject({
      listIds: ['list-1'],
      identifier: 'Graceful-Fools/wordlesolver#1',
      data: {
        title: '[Astrid sync fixture] Open issue in Todo',
        statusRole: 'ready',
        completed: false,
        isPrivate: false,
        remoteNodeId: items[0].content!.id,
        remoteKind: 'issue',
      },
    })
    // The closed-not-planned issue arrives completed, stamped.
    expect(call.tasks[1].data).toMatchObject({ completed: true, closedReason: 'not_planned', completedAt: expect.any(Date) })
    // The draft has no identifier.
    expect(call.tasks[2].identifier).toBeNull()

    expect(db.gitHubProjectItem.createMany).toHaveBeenCalledWith({
      data: items.map((item, i) => ({ itemNodeId: item.id, projectId: 'proj-1', taskId: `new-${i}` })),
      skipDuplicates: true,
    })
  })

  it('reads twice per page, whatever its size (no N+1)', async () => {
    await applyProjectItems(board, items)
    expect(db.task.findMany).toHaveBeenCalledTimes(1)
    expect(db.gitHubProjectItem.findMany).toHaveBeenCalledTimes(1)
  })

  it('an unchanged, already-mirrored page writes nothing', async () => {
    db.task.findMany.mockResolvedValue(items.map((item, i) => replicaOf(item, `t${i}`)))
    db.gitHubProjectItem.findMany.mockResolvedValue(items.map(item => ({ itemNodeId: item.id, archived: false })))

    expect(await applyProjectItems(board, items)).toMatchObject({ unchanged: 3, created: 0, updated: 0 })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(bulk.createTasksInBulk).not.toHaveBeenCalled()
  })

  it('a changed item is patched by value — reopening clears completion and its stamp', async () => {
    const replica = { ...replicaOf(items[0], 't0'), completed: true, closedReason: 'not_planned', statusRole: null }
    db.task.findMany.mockResolvedValue([replica])
    db.gitHubProjectItem.findMany.mockResolvedValue([{ itemNodeId: items[0].id, archived: false }])

    expect(await applyProjectItems(board, [items[0]])).toMatchObject({ updated: 1 })
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: 't0' },
      data: { completed: false, closedReason: null, statusRole: 'ready', completedAt: null },
    })
  })

  it('an archived item leaves the list and keeps the task', async () => {
    const archived = { ...items[0], isArchived: true }
    db.task.findMany.mockResolvedValue([replicaOf(items[0], 't0')])
    db.gitHubProjectItem.findMany.mockResolvedValue([{ itemNodeId: items[0].id, archived: false }])

    expect(await applyProjectItems(board, [archived])).toMatchObject({ left: 1 })
    expect(db.gitHubProjectItem.update).toHaveBeenCalledWith({ where: { itemNodeId: items[0].id }, data: { archived: true } })
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't0' }, data: { lists: { disconnect: { id: 'list-1' } } } })
  })

  it('a task already mirrored by ANOTHER board joins this one rather than being duplicated', async () => {
    db.task.findMany.mockResolvedValue([replicaOf(items[0], 't0')])

    expect(await applyProjectItems(board, [items[0]])).toMatchObject({ updated: 1, created: 0 })
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't0' }, data: { lists: { connect: { id: 'list-1' } } } })
    expect(db.gitHubProjectItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { itemNodeId: items[0].id, projectId: 'proj-1', taskId: 't0' } }),
    )
  })
})

/** `item` as an issue with GitHub relationships (the fragment's P6c fields). */
function related(item: RemoteProjectItem, parent: string | null, blockedBy: string[] = []): RemoteProjectItem {
  return {
    ...item,
    content: {
      ...item.content!,
      parent: parent ? { id: parent } : null,
      blockedBy: { totalCount: blockedBy.length, nodes: blockedBy.map(id => ({ id })) },
    },
  }
}

/** A replica row as the writer reads it back, relationships included. */
function mirrored(item: RemoteProjectItem, id: string, relations: { parentTaskId?: string; parentNode?: string; blockers?: string[] } = {}) {
  return {
    ...replicaOf(item, id),
    parentTaskId: relations.parentTaskId ?? null,
    parentTask: relations.parentTaskId ? { remoteNodeId: relations.parentNode ?? null } : null,
    blockedBy: (relations.blockers ?? []).map(blockingTaskId => ({ blockingTaskId })),
  }
}

describe('applyProjectItems — sub-issues and dependencies (AWTD-1119)', () => {
  const [parent, child] = items
  const parentNode = parent.content!.id
  const childNode = child.content!.id
  const members = (...of: RemoteProjectItem[]) => of.map(item => ({ itemNodeId: item.id, archived: false }))

  it('a sub-issue imported on the same page as its parent is filed under the task just created for it', async () => {
    await applyProjectItems(board, [related(child, parentNode), related(parent, null)])

    // Created in page order: the child is new-0, its parent new-1.
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 'new-0' }, data: { parentTaskId: 'new-1' } })
    expect(db.task.findMany).toHaveBeenCalledTimes(1) // both ends were on the page: no extra read
  })

  it('a blocker mirrored by another board is found with ONE extra read and becomes a TaskDependency', async () => {
    db.task.findMany
      .mockResolvedValueOnce([mirrored(child, 't-child')])
      .mockResolvedValueOnce([{ id: 't-elsewhere', remoteNodeId: 'I_elsewhere' }])
    db.gitHubProjectItem.findMany.mockResolvedValue(members(child))

    await applyProjectItems(board, [related(child, null, ['I_elsewhere', 'I_not_mirrored'])])

    expect(db.task.findMany).toHaveBeenCalledTimes(2)
    expect(db.task.findMany.mock.calls[1][0]).toEqual({
      where: { remoteNodeId: { in: ['I_elsewhere', 'I_not_mirrored'] } },
      select: { id: true, remoteNodeId: true },
    })
    expect(db.taskDependency.createMany).toHaveBeenCalledWith({
      data: [{ blockedTaskId: 't-child', blockingTaskId: 't-elsewhere' }],
      skipDuplicates: true,
    })
    expect(db.taskDependency.deleteMany).not.toHaveBeenCalled()
  })

  it('a cycle from GitHub is written as it stands — no 409, both directions kept', async () => {
    db.task.findMany.mockResolvedValue([mirrored(parent, 't-a', { blockers: ['t-b'] }), mirrored(child, 't-b')])
    db.gitHubProjectItem.findMany.mockResolvedValue(members(parent, child))

    await applyProjectItems(board, [related(parent, null, [childNode]), related(child, null, [parentNode])])

    expect(db.taskDependency.createMany).toHaveBeenCalledWith({
      data: [{ blockedTaskId: 't-b', blockingTaskId: 't-a' }],
      skipDuplicates: true,
    })
    expect(db.taskDependency.deleteMany).not.toHaveBeenCalled()
  })

  it('a dependency removed on GitHub is removed here; a sub-issue detached there is detached here', async () => {
    db.task.findMany.mockResolvedValue([mirrored(child, 't-child', { parentTaskId: 't-parent', parentNode, blockers: ['t-old'] })])
    db.gitHubProjectItem.findMany.mockResolvedValue(members(child))

    await applyProjectItems(board, [related(child, null)])

    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't-child' }, data: { parentTaskId: null } })
    expect(db.taskDependency.deleteMany).toHaveBeenCalledWith({
      where: { blockedTaskId: 't-child', blockingTaskId: { in: ['t-old'] } },
    })
  })

  it('reads only MIRRORED blockers back, so a blocker on a local Astrid task is never GitHub’s to remove', async () => {
    await applyProjectItems(board, [related(child, null)])

    expect(db.task.findMany.mock.calls[0][0].select.blockedBy).toEqual({
      where: { blockingTask: { remoteNodeId: { not: null } } },
      select: { blockingTaskId: true },
    })
  })

  it('a page with no relationships costs no extra read and no relationship write', async () => {
    db.task.findMany.mockResolvedValue(items.map((item, i) => mirrored(item, `t${i}`)))
    db.gitHubProjectItem.findMany.mockResolvedValue(members(...items))

    await applyProjectItems(board, items.map(item => (item.content?.__typename === 'Issue' ? related(item, null) : item)))

    expect(db.task.findMany).toHaveBeenCalledTimes(1)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('bindGitHubProject (AWTD-1151)', () => {
  it('creates a keyless project in the installation, its github_project list, and the binding', async () => {
    db.gitHubProjectBinding.findUnique.mockResolvedValue(null)
    db.project.create.mockResolvedValue({ id: 'proj-1' })
    db.taskList.create.mockResolvedValue({ id: 'list-1' })

    const result = await bindGitHubProject({ userId: 'user-1', installationId: 169651419, schema, proposal: proposeBinding(schema) })

    expect(result).toEqual({ ok: true, projectId: 'proj-1', listId: 'list-1' })
    const project = db.project.create.mock.calls[0][0].data
    expect(project).toMatchObject({ name: 'Graceful-Tools Test', ownerId: 'user-1', githubInstallationId: 169651419 })
    expect(project).not.toHaveProperty('key')
    expect(db.taskList.create.mock.calls[0][0].data).toMatchObject({ projectId: 'proj-1', backend: 'github_project', ownerId: 'user-1' })
    expect(db.gitHubProjectBinding.create.mock.calls[0][0].data).toMatchObject({
      projectId: 'proj-1',
      projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
      number: 2,
      statusFieldId: 'PVTSSF_lADOFEb-HM4BmXS2zhlApMc',
    })
  })

  it('a project already bound is a 409 pointing at its board, not a second board', async () => {
    db.gitHubProjectBinding.findUnique.mockResolvedValue({ projectId: 'existing' })

    expect(
      await bindGitHubProject({ userId: 'user-1', installationId: 1, schema, proposal: proposeBinding(schema) }),
    ).toEqual({ ok: false, status: 409, error: 'already_bound', projectId: 'existing' })
    expect(db.project.create).not.toHaveBeenCalled()
  })
})
