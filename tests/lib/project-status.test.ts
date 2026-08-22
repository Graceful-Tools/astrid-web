import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_STATUSES,
  VIRTUAL_DONE_COLUMN_ID,
  VIRTUAL_INBOX_COLUMN_ID,
  getProjectBoardColumns,
  getProjectDomainTasks,
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
    const columns = getProjectBoardColumns()
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const doneColumn = columns.find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    expect(inboxColumn.description).toBe('Move them to "Ready" when they are... ready!')
    expect(doneColumn.description).toBe('Complete — congrats!')
  })

  it('builds board columns with virtual Inbox first and virtual Done last', () => {
    const columns = getProjectBoardColumns()
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      'doing',
      'waiting',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('renders the same columns for every board and every member', () => {
    // The columns are config, so there is no per-user list set left for two
    // members of a shared board to resolve differently — which is the whole
    // reason status stopped being a list (AWTD-562, Stage D task b7b0c2f5).
    expect(getProjectBoardColumns().map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      'doing',
      'waiting',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('puts completed tasks in the virtual Done column', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const completedTask = task({ completed: true, statusRole: 'ready', lists: [ios] } as never)

    expect(getTaskProjectColumnId(completedTask, getProjectBoardColumns()))
      .toBe(VIRTUAL_DONE_COLUMN_ID)
  })

  it('routes project tasks without a status membership into the virtual Inbox column', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const inboxTask = task({ lists: [ios] })

    expect(getTaskProjectColumnId(inboxTask, getProjectBoardColumns()))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('keeps regular list membership and writes the status onto the field', () => {
    // A stale status row is still in the client's list set; the move must drop
    // that membership and add no new one. The status goes in `statusRole`.
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const taskInReady = task({ lists: [ios, ready] })

    const doingColumn = getProjectBoardColumns().find(column => column.id === 'doing')!
    const result = resolveProjectColumnMove(taskInReady, doingColumn, [ios, ready])

    expect(result).toEqual({ listIds: ['ios'], completed: false, statusRole: 'doing' })
  })

  it('moves to virtual Done by stripping statuses and setting completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const ready = statusList({ id: 'ready', name: 'Ready', statusRole: 'ready' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const taskInReady = task({ lists: [ios, ready] })

    const doneColumn = getProjectBoardColumns().find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    const result = resolveProjectColumnMove(taskInReady, doneColumn, [ios, ready, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: true, statusRole: null })
  })

  it('moves back to virtual Inbox by stripping statuses and clearing completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const completedTask = task({ lists: [ios, doing], completed: true })

    const inboxColumn = getProjectBoardColumns().find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
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
 * The original bug: status lists were per-user and PRIVATE, so the column a
 * card was in depended on who was looking. Alice dragged a card to Doing and
 * it joined *Alice's* Doing list; Bob resolved against his own status lists,
 * found no match, and the card fell back to Inbox. Two people, one board,
 * silently different columns — and neither was told.
 *
 * Two attempted fixes made it worse before AWTD-562 fixed the model: making
 * the lists project-scoped reintroduced the duplication that
 * 20260516000000_per_user_status_lists had removed (a user with two boards saw
 * nine status lists), and it shipped and was reverted twice.
 *
 * The fix that held was to stop status being a list at all. The role lives on
 * the shared task and the columns are config, so there is no per-user set left
 * to disagree about. Stage D (task b7b0c2f5) deleted the lists; the suite that
 * pinned their scoping rules went with them, and this is what it was for.
 */
describe('Shared board status scoping (142e4dd9)', () => {
  const card = (statusRole: string | null, listIds: string[] = ['domain-1']) =>
    ({ id: 'task-1', title: 'Fix repeating rollover', completed: false, statusRole,
       lists: listIds.map(id => ({ id })) }) as never

  it('two members of a board resolve the same card to the same column', () => {
    const columns = getProjectBoardColumns()

    // There is nothing left to vary per member: same task, same config.
    expect(getTaskProjectColumnId(card('doing'), columns)).toBe('doing')
    expect(getTaskProjectColumnId(card('doing'), columns)).toBe('doing')
  })

  it('a leftover membership in someone else\'s status list changes nothing', () => {
    // The last shape of the gap: a task written by a client that sent a
    // membership and no field. It used to read as Doing to its owner and Inbox
    // to everyone else. Membership is not read at all now, so it is Inbox for
    // everyone — one answer, and the one the server would give.
    const columns = getProjectBoardColumns()

    expect(getTaskProjectColumnId(card(null, ['domain-1', 'alice-doing']), columns))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('strips a stale status membership when moving a card', () => {
    const domainList = { id: 'domain-1', name: 'Board', listType: 'regular',
                         projectId: 'project-1', privacy: 'PRIVATE' } as never
    const staleRow = { id: 'alice-doing', name: 'Doing', listType: 'status',
                       statusRole: 'doing', projectId: null, privacy: 'PRIVATE' } as never
    const readyColumn = getProjectBoardColumns().find(column => column.id === 'ready')!

    const move = resolveProjectColumnMove(
      card(null, ['domain-1', 'alice-doing']),
      readyColumn,
      [domainList, staleRow],
    )

    expect(move).toEqual({ listIds: ['domain-1'], completed: false, statusRole: 'ready' })
  })
})

/**
 * A card must never disappear from the board.
 *
 * `getTaskProjectColumnId` used to return the raw `statusRole` when nothing
 * matched it. Columns were keyed by LIST id, so that value matched no column
 * and the card rendered in none of them — silently gone from the board while
 * still present in the list view.
 *
 * Since Stage D a column id IS the role, so the two agree by construction for
 * the defaults. The hazard survives for a CUSTOM role whose board has not
 * loaded its `customStates` yet, which is why the fallback stays.
 */
describe('a status the board cannot render falls back to Inbox (AWTD-562)', () => {
  const card = (statusRole: string | null) =>
    ({ id: 'task-1', title: 'card', completed: false, statusRole,
       lists: [{ id: 'domain-1' }] }) as never

  it('resolves to the matching column when one exists', () => {
    expect(getTaskProjectColumnId(card('ready'), getProjectBoardColumns())).toBe('ready')
  })

  it('REGRESSION: an unrenderable status lands in Inbox, not nowhere', () => {
    // 'custom-blocked' has no column on a board with no custom states.
    // Previously this returned the bare role, which matched no column id, and
    // the card vanished.
    expect(getTaskProjectColumnId(card('custom-blocked'), getProjectBoardColumns()))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('resolves a custom role once the board\'s states have loaded', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(getTaskProjectColumnId(card('custom-blocked'), columns)).toBe('custom-blocked')
  })

  it('a default role resolves to its column with no lists loaded at all', () => {
    expect(getTaskProjectColumnId(card('ready'), getProjectBoardColumns())).toBe('ready')
  })

  it('every resolved column id is one the board actually renders', () => {
    // The invariant behind all of the above.
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])
    const columnIds = new Set(columns.map(c => c.id))

    for (const role of ['ready', 'doing', 'custom-blocked', 'custom-gone', null]) {
      expect(columnIds.has(getTaskProjectColumnId(card(role), columns))).toBe(true)
    }
  })
})
