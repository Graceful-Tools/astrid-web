/**
 * AWTD-1342: services/github-mirrored-lists.service.ts had no test. The pure
 * planners (lib/github/projects/labels.ts, milestones.ts) are pinned elsewhere;
 * this pins the connect/disconnect diff the service builds from them, driven by
 * the REAL recorded page (tests/fixtures/github/graphql).
 *
 * Pinned — it must not detach lists it should not:
 *   - labels: only label-flavor lists the issue no longer carries are left;
 *     regular, status and milestone lists the task is on are never touched;
 *   - a truncated label set (totalCount above what was read) joins, never leaves;
 *   - milestones: a move joins the new list and leaves only the old milestone;
 *     labels and regular lists stay;
 *   - an archived item, a draft, or an item whose label list was not hydrated
 *     writes no membership change;
 *   - one task's diff never lands on another task.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import type { ReplicaRow } from '@/services/github-projects-replica'
import type { BoundBoard } from '@/services/github-projects.service'
import { LIST_TYPE_LABEL, LIST_TYPE_MILESTONE, LIST_TYPE_REGULAR, LIST_TYPE_STATUS } from '@/lib/list-flavors'

const db = vi.hoisted(() => ({
  task: { update: vi.fn((args: unknown) => ({ op: 'task.update', args })) },
  taskList: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn((args: unknown) => ({ op: 'list.update', args })),
  },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redis', () => ({ RedisCache: { invalidate: { userLists: vi.fn(async () => undefined) } } }))
vi.mock('@/lib/brand/capabilities', () => ({ hasCapability: () => false }))

import { applyLabels, applyMilestones } from '@/services/github-mirrored-lists.service'

const page = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql/project-items-page.json'), 'utf8'))
const items = page.data.node.items.nodes as RemoteProjectItem[]
const [issue, otherIssue] = items.filter(item => item.content?.__typename === 'Issue')
const draft = items.find(item => item.content?.__typename === 'DraftIssue')!
const REPO = 'Graceful-Fools/wordlesolver'

const board = { projectId: 'proj1', listId: 'board-list', ownerId: 'owner1', binding: {} } as unknown as BoundBoard

type Held = { id: string; remoteNodeId: string | null; listType: string; name: string; color: string | null; description: string | null }
const regular: Held = { id: 'list-regular', remoteNodeId: null, listType: LIST_TYPE_REGULAR, name: 'Inbox', color: null, description: null }
const status: Held = { id: 'list-status', remoteNodeId: 'PVTSSF_status', listType: LIST_TYPE_STATUS, name: 'Todo', color: null, description: null }
const bugList: Held = { id: 'list-bug', remoteNodeId: 'LA_bug', listType: LIST_TYPE_LABEL, name: 'bug', color: '#d73a4a', description: REPO }
const docsList: Held = { id: 'list-docs', remoteNodeId: 'LA_docs', listType: LIST_TYPE_LABEL, name: 'documentation', color: '#0075ca', description: REPO }
const v12List: Held = { id: 'list-v12', remoteNodeId: 'MI_v12', listType: LIST_TYPE_MILESTONE, name: 'v1.2', color: '#64748b', description: REPO }
const v13List: Held = { id: 'list-v13', remoteNodeId: 'MI_v13', listType: LIST_TYPE_MILESTONE, name: 'v1.3', color: '#64748b', description: REPO }

const bug = { id: 'LA_bug', name: 'bug', color: 'D73A4A' }
const docs = { id: 'LA_docs', name: 'documentation', color: '0075ca' }

function withLabels(item: RemoteProjectItem, labels: typeof bug[], totalCount = labels.length): RemoteProjectItem {
  return { ...item, content: { ...item.content!, labels: { totalCount, nodes: labels } } }
}
function withMilestone(item: RemoteProjectItem, milestone: { id: string; title: string; dueOn: string | null } | null): RemoteProjectItem {
  return { ...item, content: { ...item.content!, milestone } }
}

function replicas(...rows: Array<[RemoteProjectItem, string, Held[]]>): Map<string, ReplicaRow> {
  return new Map(rows.map(([item, id, lists]) => [item.content!.id, { id, lists } as unknown as ReplicaRow]))
}

/** The task.update writes, as { taskId: { connect, disconnect } }. */
function membershipWrites() {
  return Object.fromEntries(
    db.task.update.mock.calls.map(([args]) => {
      const { where, data } = args as { where: { id: string }; data: { lists: Record<string, Array<{ id: string }>> } }
      return [where.id, data.lists]
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  db.taskList.findMany.mockResolvedValue([])
  db.taskList.createMany.mockResolvedValue({ count: 0 })
})

describe('applyLabels membership diff (AWTD-1342)', () => {
  it('leaves only the label the issue lost — never a regular, status or milestone list', async () => {
    db.taskList.findMany.mockResolvedValue([{ id: 'list-docs', remoteNodeId: 'LA_docs', name: 'documentation', color: '#0075ca' }])
    const item = withLabels(issue, [docs])

    const wrote = await applyLabels(board, [item], replicas([item, 'task1', [regular, status, bugList, v12List]]), new Map())

    expect(wrote).toBe(true)
    expect(membershipWrites()).toEqual({ task1: { connect: [{ id: 'list-docs' }], disconnect: [{ id: 'list-bug' }] } })
  })

  it('a truncated label set joins what it read and leaves nothing', async () => {
    const item = withLabels(issue, [docs], 5)
    db.taskList.findMany.mockResolvedValue([{ id: 'list-docs', remoteNodeId: 'LA_docs', name: 'documentation', color: '#0075ca' }])

    await applyLabels(board, [item], replicas([item, 'task1', [bugList]]), new Map())

    expect(membershipWrites()).toEqual({ task1: { connect: [{ id: 'list-docs' }] } })
  })

  it('an item hydrated without its labels says nothing, so nothing is left', async () => {
    const item: RemoteProjectItem = { ...issue, content: { ...issue.content!, labels: undefined } }

    expect(await applyLabels(board, [item], replicas([item, 'task1', [bugList, docsList]]), new Map())).toBe(false)
    expect(db.task.update).not.toHaveBeenCalled()
  })

  it('an archived item or a draft changes no membership', async () => {
    const archived = { ...withLabels(issue, []), isArchived: true }
    expect(await applyLabels(board, [archived, draft], replicas([archived, 'task1', [bugList]], [draft, 'task2', [bugList]]), new Map())).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('a label held and still on GitHub writes nothing', async () => {
    const item = withLabels(issue, [bug])
    expect(await applyLabels(board, [item], replicas([item, 'task1', [bugList]]), new Map())).toBe(false)
    expect(db.taskList.findMany).not.toHaveBeenCalled()
  })

  it('each task gets its own diff', async () => {
    const a = withLabels(issue, [])
    const b = withLabels(otherIssue, [bug, docs])

    await applyLabels(board, [a, b], replicas([a, 'taskA', [bugList, regular]], [b, 'taskB', [bugList, docsList]]), new Map())

    expect(membershipWrites()).toEqual({ taskA: { disconnect: [{ id: 'list-bug' }] } })
  })

  it('a label nobody has met yet is created for the board owner and joined', async () => {
    const item = withLabels(issue, [bug])
    db.taskList.findMany
      .mockResolvedValueOnce([]) // unheld nodes: unknown
      .mockResolvedValueOnce([{ id: 'list-new-bug', remoteNodeId: 'LA_bug', name: 'bug', color: '#d73a4a' }])

    await applyLabels(board, [item], new Map(), new Map([[item.content!.id, 'task-new']]))

    expect(db.taskList.createMany).toHaveBeenCalledWith({
      data: [{ name: 'bug', color: '#d73a4a', description: REPO, ownerId: 'owner1', listType: LIST_TYPE_LABEL, remoteNodeId: 'LA_bug' }],
      skipDuplicates: true,
    })
    expect(membershipWrites()).toEqual({ 'task-new': { connect: [{ id: 'list-new-bug' }] } })
  })
})

describe('applyMilestones membership diff (AWTD-1342)', () => {
  const v13 = { id: 'MI_v13', title: 'v1.3', dueOn: null }

  it('a move joins the new milestone and leaves only the old one', async () => {
    db.taskList.findMany.mockResolvedValue([{ id: 'list-v13', remoteNodeId: 'MI_v13', name: 'v1.3', description: REPO }])
    const item = withMilestone(issue, v13)

    await applyMilestones(board, [item], replicas([item, 'task1', [regular, status, bugList, v12List]]), new Map())

    expect(membershipWrites()).toEqual({ task1: { connect: [{ id: 'list-v13' }], disconnect: [{ id: 'list-v12' }] } })
  })

  it('a milestone cleared on GitHub leaves the milestone list and nothing else', async () => {
    const item = withMilestone(issue, null)

    await applyMilestones(board, [item], replicas([item, 'task1', [regular, bugList, v12List]]), new Map())

    expect(membershipWrites()).toEqual({ task1: { disconnect: [{ id: 'list-v12' }] } })
  })

  it('a task somehow on two milestones keeps the one GitHub names', async () => {
    const item = withMilestone(issue, v13)

    await applyMilestones(board, [item], replicas([item, 'task1', [v12List, v13List]]), new Map())

    expect(membershipWrites()).toEqual({ task1: { disconnect: [{ id: 'list-v12' }] } })
  })

  it('an archived item or a draft changes no membership', async () => {
    const archived = { ...withMilestone(issue, null), isArchived: true }
    expect(await applyMilestones(board, [archived, draft], replicas([archived, 'task1', [v12List]], [draft, 'task2', [v12List]]), new Map())).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
