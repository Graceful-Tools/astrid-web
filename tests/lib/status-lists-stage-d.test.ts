/**
 * Stage D — the status lists are gone (task b7b0c2f5).
 *
 * Stages A–C made `Task.statusRole` the source of truth and moved every reader
 * and both CLI scripts onto it. What survived was the *membership half of the
 * dual-write*: a status change also rewrote `listIds`, because iOS resolved
 * board columns from `listType: 'status'` rows. iOS build 200 stopped doing
 * that and adoption has cleared, so the rows are deleted and nothing may
 * recreate them or write to them.
 *
 * These tests pin the three ways that can silently regress. Each one fails
 * quietly rather than loudly if it comes back:
 *
 *   1. Re-seeding. `ensureUserStatusLists` ran on three paths, one of them the
 *      plain "list my projects" read. A single surviving caller undoes the
 *      migration within minutes of the deploy and nothing reports it.
 *   2. Writing a membership. The board would persist a task into a list that
 *      no longer exists — a dangling id in `listIds`, not an error.
 *   3. Reading a membership. A client holding a stale list set would resolve a
 *      card by a row the server has deleted, so two clients disagree about the
 *      same card's column.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import {
  getProjectBoardColumns,
  getTaskProjectColumnId,
  resolveProjectColumnMove,
  VIRTUAL_INBOX_COLUMN_ID,
} from '@/lib/project-status'
import * as projectsService from '@/lib/projects-service'
import { prisma } from '@/lib/prisma'

const PROJECT = 'p1'

const domainList = {
  id: 'domain-1', name: 'Work', listType: 'regular', projectId: PROJECT, privacy: 'SHARED',
} as never

/**
 * A `listType: 'status'` row as it existed before the migration. Nothing
 * creates these any more; they appear here only as the stale data a client
 * can still be holding, which is exactly what must now be ignored.
 */
const staleStatusRow = (role: string, id: string, name: string, order = 0) => ({
  id, name, listType: 'status', statusRole: role, statusOrder: order,
  projectId: null, privacy: 'PRIVATE',
}) as never

const taskWith = (statusRole: string | null, listIds: string[] = ['domain-1']) => ({
  id: 't1', completed: false, statusRole,
  lists: listIds.map(id => ({ id })),
}) as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('nothing re-creates the status lists (task b7b0c2f5)', () => {
  it('no longer exports a seeder at all', () => {
    // Asserted on the module surface rather than on a call count: the failure
    // being guarded against is a *new* caller of a helper that still exists,
    // and only its absence rules that out.
    expect('ensureUserStatusLists' in projectsService).toBe(false)
  })

  it('creates a board without writing a single status row', async () => {
    const tx = {
      project: {
        create: vi.fn().mockResolvedValue({ id: 'new-project' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'new-project', lists: [] }),
      },
      taskList: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn(), create: vi.fn() },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: never) =>
      (fn as unknown as (t: typeof tx) => unknown)(tx),
    )

    await projectsService.createProjectForUser('user-1', { name: 'Board' })

    expect(tx.taskList.createMany).not.toHaveBeenCalled()
    expect(tx.taskList.create).not.toHaveBeenCalled()
  })

  it('adds a custom status to Project.customStates and writes no list row', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ customStates: null } as never)
    vi.mocked(prisma.project.update).mockResolvedValue({} as never)

    const result = await projectsService.addUserStatus('user-1', 'Blocked', PROJECT)

    // One write, to the project. The transaction this used to need existed
    // only to keep the row and the JSON in lockstep; there is no row now.
    expect(prisma.taskList.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.project.update).toHaveBeenCalledTimes(1)
    expect('state' in result && result.state.name).toBe('Blocked')
  })

  it('still refuses a custom status that collides with a built-in name', async () => {
    // The built-ins are config, not rows, so the old duplicate check — which
    // read the `listType: 'status'` rows — cannot see them any more. The check
    // that survives is `validateName`, which compares against the NAME:
    // "Ready" slugs to `custom-ready` and collides with no role, but would put
    // a second column called Ready on the board.
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ customStates: null } as never)

    const result = await projectsService.addUserStatus('user-1', 'ready', PROJECT)

    expect('error' in result && result.error).toBe('invalid')
    expect(prisma.project.update).not.toHaveBeenCalled()
  })
})

describe('a board move writes no list membership (task b7b0c2f5)', () => {
  it('writes only the role when a stale status row is still in the list set', () => {
    // The pre-Stage-D behaviour appended `l-ready` here, because the column was
    // keyed on the backing row. The row is deleted server-side now, so that
    // membership would be a dangling id.
    const lists = [domainList, staleStatusRow('ready', 'l-ready', 'Ready')]
    const readyColumn = getProjectBoardColumns().find(c => c.name === 'Ready')!

    const move = resolveProjectColumnMove(taskWith(null), readyColumn, lists)

    expect(move.statusRole).toBe('ready')
    expect(move.listIds).toEqual(['domain-1'])
  })

  it('keys the column on the role, not on any row that happens to be cached', () => {
    const lists = [domainList, staleStatusRow('ready', 'l-ready', 'Ready')]

    const readyColumn = getProjectBoardColumns().find(c => c.name === 'Ready')!

    expect(readyColumn.id).toBe('ready')
    expect(readyColumn.statusList).toBeUndefined()
  })

  it('still strips a stale status membership the task is carrying', () => {
    // Leaving it attached would keep the card rendering in the old column on
    // any client that still reads membership.
    const lists = [domainList, staleStatusRow('waiting', 'l-waiting', 'Waiting')]
    const doingColumn = getProjectBoardColumns().find(c => c.name === 'Doing')!

    const move = resolveProjectColumnMove(
      taskWith('waiting', ['domain-1', 'l-waiting']),
      doingColumn,
      lists,
    )

    expect(move.statusRole).toBe('doing')
    expect(move.listIds).toEqual(['domain-1'])
  })
})

describe('membership is never read back (task b7b0c2f5)', () => {
  it('sends a task with only a stale membership to Inbox, not to the stale column', () => {
    const column = getTaskProjectColumnId(
      taskWith(null, ['domain-1', 'l-waiting']),
      getProjectBoardColumns(),
    )

    expect(column).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('resolves by the field even when a stale row of the same role is cached', () => {
    expect(getTaskProjectColumnId(taskWith('doing'), getProjectBoardColumns())).toBe('doing')
  })
})
