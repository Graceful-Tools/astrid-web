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
  scopeProjectBoardTasks,
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

    expect(result).toEqual({ listIds: ['ios'], completed: true })
  })

  it('moves back to virtual Inbox by stripping statuses and clearing completed', () => {
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId: 'project-1', listType: 'regular' })
    const doing = statusList({ id: 'doing', name: 'Doing', statusRole: 'doing' })
    const completedTask = task({ lists: [ios, doing], completed: true })

    const columns = getProjectBoardColumns([ios, doing])
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const result = resolveProjectColumnMove(completedTask, inboxColumn, [ios, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: false })
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

describe('scopeProjectBoardTasks (task 94e79fd8 — project board #4)', () => {
  const listA = { id: 'list-a', projectId: 'proj-1', listType: 'regular' } as unknown as TaskList
  const listB = { id: 'list-b', projectId: 'proj-1', listType: 'regular' } as unknown as TaskList
  const statusList = { id: 'ready', projectId: null, listType: 'status' } as unknown as TaskList

  const tasks = [
    { id: 't-a', lists: [{ id: 'list-a' }] },
    { id: 't-b', lists: [{ id: 'list-b' }] },
  ] as unknown as Task[]

  it("scope 'list' narrows to the selected domain list's tasks", () => {
    const result = scopeProjectBoardTasks(tasks, listA, 'proj-1', 'list')
    expect(result.map(t => t.id)).toEqual(['t-a'])
  })

  it("scope 'project' returns every task across the project's lists", () => {
    const result = scopeProjectBoardTasks(tasks, listA, 'proj-1', 'project')
    expect(result.map(t => t.id)).toEqual(['t-a', 't-b'])
  })

  it('returns the full project set when a status list is selected (no single list to narrow to)', () => {
    const result = scopeProjectBoardTasks(tasks, statusList, 'proj-1', 'list')
    expect(result.map(t => t.id)).toEqual(['t-a', 't-b'])
  })

  it('returns the full project set when nothing is selected', () => {
    expect(scopeProjectBoardTasks(tasks, undefined, 'proj-1', 'list').map(t => t.id)).toEqual(['t-a', 't-b'])
  })

  it('narrows to a different domain list when that one is selected', () => {
    expect(scopeProjectBoardTasks(tasks, listB, 'proj-1', 'list').map(t => t.id)).toEqual(['t-b'])
  })
})
