import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_STATUSES,
  VIRTUAL_DONE_COLUMN_ID,
  VIRTUAL_INBOX_COLUMN_ID,
  getProjectBoardColumns,
  getProjectDomainTasks,
  getProjectStatusLists,
  getTaskProjectColumnId,
  normalizeProjectStatusListIds,
  resolveProjectColumnMove,
} from '@/lib/project-status'
import type { Task, TaskList } from '@/types/task'

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

function list(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return {
    id: overrides.id,
    name: overrides.name,
    privacy: 'PRIVATE',
    owner,
    ownerId: owner.id,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lists: [],
    ...overrides,
  } as unknown as TaskList
}

function task(overrides: Partial<Task> & { lists: TaskList[] }): Task {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    creator: owner,
    creatorId: owner.id,
    priority: 0,
    lists: overrides.lists,
    isPrivate: true,
    completed: false,
    attachments: [],
    comments: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    repeating: 'never',
    repeatFrom: 'COMPLETION_DATE',
    occurrenceCount: 0,
    ...overrides,
  }
}

// Status lists are now per-user globals: projectId = null, shared across
// every project board. Domain lists keep their project id.
function statusList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return list({ projectId: null, listType: 'status', ...overrides })
}

describe('project status', () => {
  it('seeds only Ready, Doing, and Waiting as real status lists', () => {
    expect(DEFAULT_PROJECT_STATUSES.map(status => status.name)).toEqual([
      'Ready',
      'Doing',
      'Waiting',
    ])
    expect(DEFAULT_PROJECT_STATUSES.every(status => status.description.length > 12)).toBe(true)
  })

  it('uses the approved copy for the virtual Inbox and Done columns', () => {
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready', statusOrder: 0 })
    const columns = getProjectBoardColumns([ready])
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const doneColumn = columns.find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    expect(inboxColumn.description).toBe('Move them to "Ready" when they are... ready!')
    expect(doneColumn.description).toBe('Complete — congrats!')
  })

  it('builds board columns with virtual Inbox first and virtual Done last', () => {
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready', statusOrder: 0 })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing', statusOrder: 1 })
    const waiting = statusList({ id: 'waiting', name: 'Waiting', statusRole: 'waiting', statusOrder: 2 })

    const columns = getProjectBoardColumns([ready, doing, waiting])
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      'doing',
      'waiting',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('renders the same per-user status columns regardless of the project board', () => {
    // The user's global Ready/Doing have projectId null; the board renders
    // them even though no list in the set carries the project's id.
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready', statusOrder: 0 })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing', statusOrder: 1 })
    const projectA = list({ id: 'a', name: 'Project A list', projectId: 'project-a', listType: 'regular' })

    const columns = getProjectBoardColumns([projectA, ready, doing])
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      'doing',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('hides legacy inbox/done status lists from the board so virtual columns own them', () => {
    const legacyInbox = statusList({ id: 'inbox', name: 'Inbox', statusRole: 'inbox', statusOrder: -1 })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready', statusOrder: 0 })
    const legacyDone = statusList({ id: 'done', name: 'Done', statusRole: 'done', statusCompleted: true, statusOrder: 9 })

    const columns = getProjectBoardColumns([legacyInbox, ready, legacyDone])
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('puts completed tasks in the virtual Done column', () => {
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const completedTask = task({ completed: true, lists: [ready] })

    expect(getTaskProjectColumnId(completedTask, [ready])).toBe(VIRTUAL_DONE_COLUMN_ID)
  })

  it('routes project tasks without a status membership into the virtual Inbox column', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const inboxTask = task({ lists: [ios] })

    expect(getTaskProjectColumnId(inboxTask, [ios, doing])).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('keeps regular list membership while replacing the project status membership', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const taskInReady = task({ lists: [ios, ready] })

    const columns = getProjectBoardColumns([ios, ready, doing])
    const doingColumn = columns.find(column => column.id === 'doing')!
    const result = resolveProjectColumnMove(taskInReady, doingColumn, [ios, ready, doing])

    expect(result.listIds).toEqual(['ios', 'doing'])
    expect(result.completed).toBe(false)
  })

  it('moves to virtual Done by stripping statuses and setting completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const taskInReady = task({ lists: [ios, ready] })

    const columns = getProjectBoardColumns([ios, ready, doing])
    const doneColumn = columns.find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    const result = resolveProjectColumnMove(taskInReady, doneColumn, [ios, ready, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: true, statusRole: null })
  })

  it('moves back to virtual Inbox by stripping statuses and clearing completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const completedTask = task({ lists: [ios, doing], completed: true })

    const columns = getProjectBoardColumns([ios, doing])
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const result = resolveProjectColumnMove(completedTask, inboxColumn, [ios, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: false, statusRole: null })
  })

  it('normalizes direct list updates to a single global status and forces completed=false', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })

    expect(normalizeProjectStatusListIds(['ios', 'ready', 'doing'], [ios, ready, doing])).toEqual({
      listIds: ['ios', 'doing'],
      completedFromStatus: false,
    })
  })

  it('strips every status when the task is being completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })

    expect(
      normalizeProjectStatusListIds(['ios', 'ready'], [ios, ready], { completed: true }),
    ).toEqual({ listIds: ['ios'] })
  })

  it('does not auto-add a status when a project task is created without one', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing', statusOrder: 1 })

    expect(normalizeProjectStatusListIds(['ios'], [ios, doing])).toEqual({
      listIds: ['ios'],
    })
  })

  it('getProjectDomainTasks only returns tasks attached to a regular project list', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const otherProjectList = list({ id: 'web', name: 'Web', projectId: 'project-2', listType: 'regular' })
    const status = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const inProject = task({ id: 't-1', lists: [ios] })
    const onlyStatus = task({ id: 't-2', lists: [status] })
    const outsideProject = task({ id: 't-3', lists: [otherProjectList] })

    const result = getProjectDomainTasks(
      [inProject, onlyStatus, outsideProject],
      [ios, otherProjectList, status],
      projectId,
    )
    expect(result.map(t => t.id)).toEqual(['t-1'])
  })
})

/**
 * Task 142e4dd9 — shared boards must share status.
 *
 * SUPERSEDED IN PART. The project-scoped status lists this suite originally
 * pinned were reverted: they reintroduced the duplication that
 * 20260516000000_per_user_status_lists had removed (a user with two boards saw
 * nine status lists). Status lists are per-user singletons again.
 *
 * The consequence is stated plainly rather than hidden: on a board shared
 * between two people, each resolves against their OWN status set, so they can
 * still disagree about which column a card is in. Fixing that needs status to
 * stop being a list membership — see the follow-up task. These tests now pin
 * the per-user rule and document the gap.
 *
 * The bug: status lists were per-user and PRIVATE, so `getProjectStatusLists`
 * resolved against whichever user was looking. Alice dragged a card to Doing
 * and it joined *Alice's* Doing list; Bob resolved against his own status
 * lists, found no match, and the card fell back to Inbox. Two people, one
 * board, silently different columns — and neither was told.
 */
describe('Shared board status scoping (142e4dd9)', () => {
  const PROJECT = 'project-1'

  const personalStatus = (owner: string, role: string, id: string) => ({
    id,
    name: role === 'ready' ? 'Ready' : role === 'doing' ? 'Doing' : 'Waiting',
    ownerId: owner,
    privacy: 'PRIVATE',
    listType: 'status',
    statusRole: role,
    statusOrder: role === 'ready' ? 0 : role === 'doing' ? 1 : 2,
    projectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as never

  const projectStatus = (role: string, id: string) => ({
    id,
    name: role === 'ready' ? 'Ready' : role === 'doing' ? 'Doing' : 'Waiting',
    ownerId: 'alice',
    privacy: 'PRIVATE',
    listType: 'status',
    statusRole: role,
    statusOrder: role === 'ready' ? 0 : role === 'doing' ? 1 : 2,
    projectId: PROJECT,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as never

  const domainList = {
    id: 'domain-1',
    name: 'Team board',
    ownerId: 'alice',
    privacy: 'PRIVATE',
    listType: 'regular',
    projectId: PROJECT,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never

  const taskIn = (listIds: string[]) => ({
    id: 'task-1',
    title: 'Fix repeating rollover',
    completed: false,
    lists: listIds.map(id => ({ id })),
  }) as never

  it('KNOWN GAP: two members resolve against their own status sets', () => {
    // Documents the cost of reverting project-scoped statuses. A card in
    // Alice's Doing reads as Doing to Alice and Inbox to Bob, because Bob
    // resolves against his own set. This is a real gap, tracked separately —
    // the alternative was nine status lists per user, which shipped and was
    // worse.
    const aliceLists = [domainList, personalStatus('alice', 'doing', 'alice-doing')]
    const bobLists = [domainList, personalStatus('bob', 'doing', 'bob-doing')]
    const task = taskIn(['domain-1', 'alice-doing'])

    expect(getTaskProjectColumnId(task, aliceLists, PROJECT)).toBe('alice-doing')
    expect(getTaskProjectColumnId(task, bobLists, PROJECT)).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('REGRESSION: the pre-fix arrangement is exactly what used to disagree', () => {
    // Reproduces the old behaviour to prove the test would have caught it:
    // with only personal statuses, a card in Alice's Doing is Inbox to Bob.
    const aliceLists = [domainList, personalStatus('alice', 'doing', 'alice-doing')]
    const bobLists = [domainList, personalStatus('bob', 'doing', 'bob-doing')]
    const task = taskIn(['domain-1', 'alice-doing'])

    expect(getTaskProjectColumnId(task, aliceLists, PROJECT)).toBe('alice-doing')
    expect(getTaskProjectColumnId(task, bobLists, PROJECT)).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('returns the per-user set, never a per-project duplicate', () => {
    const lists = [
      domainList,
      personalStatus('alice', 'ready', 'alice-ready'),
      personalStatus('alice', 'doing', 'alice-doing'),
      projectStatus('ready', 'proj-ready'),
      projectStatus('doing', 'proj-doing'),
    ]

    // The bug: this used to prefer 'proj-*', so each extra board added three
    // more status lists to the user's account.
    const statuses = getProjectStatusLists(lists, PROJECT)
    expect(statuses.map(s => s.id)).toEqual(['alice-ready', 'alice-doing'])
  })

  it('falls back to personal statuses for a board that has not been promoted', () => {
    // Solo boards keep working exactly as before — this is the byte-identical
    // single-player path.
    const lists = [
      domainList,
      personalStatus('alice', 'ready', 'alice-ready'),
      personalStatus('alice', 'doing', 'alice-doing'),
    ]

    expect(getProjectStatusLists(lists, PROJECT).map(s => s.id))
      .toEqual(['alice-ready', 'alice-doing'])
  })

  it('never leaks another project\'s status columns', () => {
    const lists = [
      domainList,
      projectStatus('ready', 'proj-ready'),
      { ...(projectStatus('ready', 'other-ready') as never), projectId: 'project-2' } as never,
      personalStatus('alice', 'doing', 'alice-doing'),
    ]

    const ids = getProjectStatusLists(lists, PROJECT).map(s => s.id)
    expect(ids).toContain('proj-ready')
    expect(ids).not.toContain('other-ready')
  })

  it('collapses a stray project-scoped row into the single per-role entry', () => {
    const lists = [
      domainList,
      { ...(projectStatus('ready', 'other-ready') as never), projectId: 'project-2' } as never,
      personalStatus('alice', 'doing', 'alice-doing'),
    ]

    // Exactly one entry per role, whichever rows happen to exist mid-cleanup.
    const statuses = getProjectStatusLists(lists, PROJECT)
    expect(new Set(statuses.map(s => s.statusRole)).size).toBe(statuses.length)
  })

  it('builds board columns from the per-user set, with no duplicate roles', () => {
    const lists = [domainList, projectStatus('ready', 'proj-ready'), personalStatus('alice', 'ready', 'alice-ready')]
    const columns = getProjectBoardColumns(lists, PROJECT)

    expect(columns[0].kind).toBe('inbox')
    expect(columns[columns.length - 1].kind).toBe('done')
    // One Ready column, not two.
    expect(columns.filter(c => c.kind === 'status').map(c => c.id)).toEqual(['alice-ready'])
  })

  it('strips a stale personal status when moving a card on a promoted board', () => {
    // A task carried into promotion may still hold the owner's personal status.
    // Moving it must clear that, or the task sits in two columns at once.
    const lists = [domainList, projectStatus('doing', 'proj-doing'), personalStatus('alice', 'ready', 'alice-ready')]
    const task = taskIn(['domain-1', 'alice-ready'])
    const targetColumn = getProjectBoardColumns(lists, PROJECT).find(c => c.id === 'proj-doing')!

    const result = resolveProjectColumnMove(task, targetColumn, lists)

    expect(result.listIds).toContain('domain-1')
    expect(result.listIds).toContain('proj-doing')
    expect(result.listIds).not.toContain('alice-ready')
    expect(result.completed).toBe(false)
  })
})

/**
 * A card must never disappear from the board.
 *
 * getTaskProjectColumnId used to return the raw statusRole when no status list
 * matched it. Board columns are keyed by LIST id, so that value matched no
 * column and the card rendered in none of them — silently gone from the board
 * while still existing in the list view.
 *
 * Reachable two ways: a user whose status lists have not loaded (or do not
 * exist yet), and any custom state once per-project custom states ship, since
 * those have no backing list at all.
 */
describe('a status the board cannot render falls back to Inbox (AWTD-562)', () => {
  const domain = {
    id: 'domain-1', name: 'Board', ownerId: 'alice', privacy: 'PRIVATE',
    listType: 'regular', projectId: 'project-1', createdAt: new Date(), updatedAt: new Date(),
  } as never

  const readyList = {
    id: 'alice-ready', name: 'Ready', ownerId: 'alice', privacy: 'PRIVATE',
    listType: 'status', statusRole: 'ready', statusOrder: 0, projectId: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as never

  const card = (statusRole: string | null) =>
    ({ id: 'task-1', title: 'card', completed: false, statusRole, lists: [{ id: 'domain-1' }] }) as never

  it('resolves to the matching column when one exists', () => {
    expect(getTaskProjectColumnId(card('ready'), [domain, readyList], 'project-1')).toBe('alice-ready')
  })

  it('REGRESSION: an unrenderable status lands in Inbox, not nowhere', () => {
    // 'blocked' has no status list. Previously this returned 'blocked', which
    // matched no column id, and the card vanished.
    expect(getTaskProjectColumnId(card('blocked'), [domain, readyList], 'project-1'))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('REGRESSION: a status set with no lists loaded still shows the card', () => {
    expect(getTaskProjectColumnId(card('ready'), [domain], 'project-1'))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('every resolved column id is one the board actually renders', () => {
    // The invariant behind all of the above.
    const lists = [domain, readyList]
    const columnIds = new Set(getProjectBoardColumns(lists, 'project-1').map(c => c.id))
    for (const role of ['ready', 'blocked', 'doing', null]) {
      expect(columnIds.has(getTaskProjectColumnId(card(role), lists, 'project-1'))).toBe(true)
    }
  })
})
