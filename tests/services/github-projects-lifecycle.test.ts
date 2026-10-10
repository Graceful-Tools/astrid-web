/**
 * AWTD-1153 (P4e): GitHub Projects boards over time (spec §8.1, §8.6, §8.7).
 *
 *   - a killed webhook is healed by reconcile: an edit nobody heard about is
 *     applied on the next pass;
 *   - an item we hold that GitHub no longer lists is asked about by id, and
 *     leaves only if GitHub confirms it is gone;
 *   - roles follow each user's GitHub permission; the owner is never touched;
 *     an unusable token leaves a membership alone;
 *   - an issue deleted on GitHub deletes its task through the delete service,
 *     as the remote's own news;
 *   - uninstall/suspend detach; unsuspend reattaches; only an UNINSTALLED board
 *     older than 30 days is purged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  gitHubProjectItem: { findMany: vi.fn() },
  gitHubProjectBinding: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  gitHubInstallation: { findMany: vi.fn() },
  gitHubInstallationAccess: { findMany: vi.fn() },
  user: { updateMany: vi.fn() },
  taskList: { findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn((a: unknown) => ({ op: 'list.deleteMany', a })) },
  task: { findUnique: vi.fn(), deleteMany: vi.fn((a: unknown) => ({ op: 'task.deleteMany', a })) },
  project: { delete: vi.fn((a: unknown) => ({ op: 'project.delete', a })) },
  $transaction: vi.fn(async (ops: unknown) => ops),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const boards = vi.hoisted(() => ({
  boundBoard: vi.fn(),
  applyProjectItems: vi.fn(async () => ({ created: 0, updated: 1, left: 0, unchanged: 0, skipped: 0 })),
  removeProjectItem: vi.fn(async () => true),
}))
vi.mock('@/services/github-projects.service', () => boards)

const members = vi.hoisted(() => ({ addListMember: vi.fn(), changeListMemberRole: vi.fn(), removeListMember: vi.fn() }))
vi.mock('@/services/list-member.service', () => members)

const tasks = vi.hoisted(() => ({ deleteTaskWithSideEffects: vi.fn(async () => ({ deleted: true, audience: [] })) }))
vi.mock('@/services/task.service', () => tasks)

import {
  PURGE_AFTER_MS,
  deleteRemoteTask,
  detachInstallationBoards,
  purgeDetachedBoards,
  reattachInstallationBoards,
  reconcileProject,
  syncBoardRoles,
} from '@/services/github-projects-lifecycle.service'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const page = load('project-items-page.json')
const pageItems = page.data.node.items.nodes as Array<{ id: string }>

const board = {
  projectId: 'proj-1',
  listId: 'list-1',
  ownerId: 'owner',
  projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
  installationId: 169651419,
  binding: load('binding-graceful-fools.json'),
}

/** A client answering each GraphQL call with the next body. */
function replaying(...bodies: unknown[]) {
  const queue = [...bodies]
  return createGraphqlClient({
    token: 't',
    bucket: 'installation:1',
    priority: 'reconcile',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(queue.shift()))) as never,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  boards.boundBoard.mockResolvedValue(board)
  db.gitHubProjectItem.findMany.mockResolvedValue([])
})

describe('reconcileProject (AWTD-1153)', () => {
  it('heals a killed webhook: every listed item is applied, and the pass is stamped', async () => {
    db.gitHubProjectItem.findMany.mockResolvedValue(pageItems.map(i => ({ itemNodeId: i.id })))
    const summary = await reconcileProject('proj-1', replaying(page))

    expect(boards.applyProjectItems).toHaveBeenCalledWith(board, pageItems)
    expect(summary).toMatchObject({ updated: 1, checked: 0, removed: 0 })
    expect(db.gitHubProjectBinding.update).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      data: { lastReconciledAt: expect.any(Date) },
    })
  })

  it('an item we hold that GitHub no longer has leaves the board', async () => {
    db.gitHubProjectItem.findMany.mockResolvedValue([...pageItems.map(i => ({ itemNodeId: i.id })), { itemNodeId: 'PVTI_gone' }])
    const summary = await reconcileProject('proj-1', replaying(page, load('hydrate-item-missing.json')))

    expect(boards.removeProjectItem).toHaveBeenCalledWith(board, 'PVTI_gone')
    expect(summary).toMatchObject({ checked: 1, removed: 1 })
  })

  it('an item missing from the listing but still on GitHub is applied, not removed', async () => {
    db.gitHubProjectItem.findMany.mockResolvedValue([{ itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y' }])
    const emptyPage = structuredClone(page)
    emptyPage.data.node.items.nodes = []
    await reconcileProject('proj-1', replaying(emptyPage, load('hydrate-item-draft.json')))

    expect(boards.removeProjectItem).not.toHaveBeenCalled()
    expect(boards.applyProjectItems).toHaveBeenLastCalledWith(board, [
      expect.objectContaining({ id: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y' }),
    ])
  })
})

describe('syncBoardRoles (AWTD-1153)', () => {
  const user = (id: string) => ({ user: { id, name: id, email: `${id}@example.com`, image: null } })
  const viewer = (canUpdate: boolean, canClose: boolean) =>
    replaying({
      data: {
        node: { id: 'PVT', viewerCanUpdate: canUpdate, viewerCanClose: canClose },
        viewer: { id: 'U_newcomer', databaseId: 42 },
        rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T15:00:00Z' },
      },
    })
  const hidden = () => replaying({ data: { node: null, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T15:00:00Z' } } })

  beforeEach(() => {
    db.taskList.findUnique.mockResolvedValue({
      id: 'list-1',
      name: 'Board',
      color: '#000',
      ownerId: 'owner',
      isVirtual: false,
      listMembers: [
        { userId: 'owner', role: 'admin' },
        { userId: 'demoted', role: 'admin' },
        { userId: 'left', role: 'member' },
        { userId: 'tokenless', role: 'member' },
      ],
    })
    db.gitHubInstallationAccess.findMany.mockResolvedValue(
      ['owner', 'newcomer', 'demoted', 'left', 'tokenless'].map(user),
    )
  })

  it('adds, changes and removes from GitHub’s answer; never the owner; leaves the unknowable alone', async () => {
    const clients: Record<string, () => ReturnType<typeof replaying> | null> = {
      newcomer: () => viewer(true, false),
      demoted: () => viewer(false, false),
      left: () => hidden(),
      tokenless: () => null,
    }
    const userClient = vi.fn(async (id: string) => clients[id]?.() ?? null)

    const summary = await syncBoardRoles('proj-1', userClient)

    expect(summary).toEqual({ added: 1, changed: 1, removed: 1, unknown: 1 })
    expect(userClient).not.toHaveBeenCalledWith('owner')
    expect(members.addListMember).toHaveBeenCalledWith(expect.objectContaining({ role: 'member', member: expect.objectContaining({ id: 'newcomer' }) }))
    expect(members.changeListMemberRole).toHaveBeenCalledWith(expect.objectContaining({ role: 'viewer', member: expect.objectContaining({ id: 'demoted' }) }))
    expect(members.removeListMember).toHaveBeenCalledWith(expect.objectContaining({ member: expect.objectContaining({ id: 'left' }) }))
  })

  it('records each member’s GitHub identity on the way — what assigning needs (AWTD-1116 P5c)', async () => {
    await syncBoardRoles('proj-1', async id => (id === 'newcomer' ? viewer(true, false) : null))
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'newcomer', OR: [{ githubNodeId: null }, { NOT: { githubNodeId: 'U_newcomer' } }] },
      data: { githubNodeId: 'U_newcomer', githubUserId: 42 },
    })
  })
})

describe('deleteRemoteTask (AWTD-1153)', () => {
  it('deletes the mirrored task through the delete service, as the remote’s own news', async () => {
    db.task.findUnique.mockResolvedValue({ id: 't1' })
    expect(await deleteRemoteTask('I_kw', 'system')).toBe(true)
    expect(tasks.deleteTaskWithSideEffects).toHaveBeenCalledWith({ taskId: 't1', actorId: 'system', actorName: 'GitHub', origin: 'remote' })
  })

  it('an issue nobody mirrors is nothing to do', async () => {
    db.task.findUnique.mockResolvedValue(null)
    expect(await deleteRemoteTask('I_kw', 'system')).toBe(false)
    expect(tasks.deleteTaskWithSideEffects).not.toHaveBeenCalled()
  })
})

describe('uninstall and suspend (AWTD-1153)', () => {
  it('detach marks the installation’s attached boards; reattach clears them', async () => {
    db.gitHubProjectBinding.updateMany.mockResolvedValue({ count: 2 })
    const now = new Date('2026-10-10T12:00:00Z')

    expect(await detachInstallationBoards(7, now)).toBe(2)
    expect(db.gitHubProjectBinding.updateMany).toHaveBeenCalledWith({ where: { installationId: 7, detachedAt: null }, data: { detachedAt: now } })
    await reattachInstallationBoards(7)
    expect(db.gitHubProjectBinding.updateMany).toHaveBeenLastCalledWith({
      where: { installationId: 7, detachedAt: { not: null } },
      data: { detachedAt: null },
    })
  })

  it('purges only boards detached over 30 days ago whose installation is gone — not a suspension', async () => {
    const now = new Date('2026-11-20T00:00:00Z')
    db.gitHubProjectBinding.findMany.mockResolvedValue([
      { projectId: 'uninstalled', installationId: 1 },
      { projectId: 'suspended', installationId: 2 },
    ])
    db.gitHubInstallation.findMany.mockResolvedValue([{ id: 2 }])
    db.taskList.findMany.mockResolvedValue([{ id: 'gh-list' }])

    expect(await purgeDetachedBoards(now)).toBe(1)
    expect(db.gitHubProjectBinding.findMany.mock.calls[0][0].where).toEqual({
      detachedAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) },
    })
    expect(db.project.delete).toHaveBeenCalledWith({ where: { id: 'uninstalled' } })
    expect(db.project.delete).not.toHaveBeenCalledWith({ where: { id: 'suspended' } })
    // Only tasks on this board and nowhere else.
    expect((db.task.deleteMany.mock.calls[0][0] as { where: unknown }).where).toMatchObject({
      remoteNodeId: { not: null },
      lists: { every: { id: { in: ['gh-list'] } } },
    })
  })
})
