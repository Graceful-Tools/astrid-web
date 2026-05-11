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
    const projectId = 'project-1'
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready', statusOrder: 0 })
    const columns = getProjectBoardColumns([ready], projectId)
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const doneColumn = columns.find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    expect(inboxColumn.description).toBe('Move them to "Ready" when they are... ready!')
    expect(doneColumn.description).toBe('Complete — congrats!')
  })

  it('builds board columns with virtual Inbox first and virtual Done last', () => {
    const projectId = 'project-1'
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready', statusOrder: 0 })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing', statusOrder: 1 })
    const waiting = list({ id: 'waiting', name: 'Waiting', projectId, listType: 'status', statusRole: 'waiting', statusOrder: 2 })

    const columns = getProjectBoardColumns([ready, doing, waiting], projectId)
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      'doing',
      'waiting',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('hides legacy inbox/done status lists from the board so virtual columns own them', () => {
    const projectId = 'project-1'
    const legacyInbox = list({ id: 'inbox', name: 'Inbox', projectId, listType: 'status', statusRole: 'inbox', statusOrder: -1 })
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready', statusOrder: 0 })
    const legacyDone = list({ id: 'done', name: 'Done', projectId, listType: 'status', statusRole: 'done', statusCompleted: true, statusOrder: 9 })

    const columns = getProjectBoardColumns([legacyInbox, ready, legacyDone], projectId)
    expect(columns.map(column => column.id)).toEqual([
      VIRTUAL_INBOX_COLUMN_ID,
      'ready',
      VIRTUAL_DONE_COLUMN_ID,
    ])
  })

  it('puts completed tasks in the virtual Done column', () => {
    const projectId = 'project-1'
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })
    const completedTask = task({ completed: true, lists: [ready] })

    expect(getTaskProjectColumnId(completedTask, projectId, [ready])).toBe(VIRTUAL_DONE_COLUMN_ID)
  })

  it('routes project tasks without a status membership into the virtual Inbox column', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing' })
    const inboxTask = task({ lists: [ios] })

    expect(getTaskProjectColumnId(inboxTask, projectId, [ios, doing])).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('keeps regular list membership while replacing the project status membership', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing' })
    const taskInReady = task({ lists: [ios, ready] })

    const columns = getProjectBoardColumns([ios, ready, doing], projectId)
    const doingColumn = columns.find(column => column.id === 'doing')!
    const result = resolveProjectColumnMove(taskInReady, doingColumn, projectId, [ios, ready, doing])

    expect(result.listIds).toEqual(['ios', 'doing'])
    expect(result.completed).toBe(false)
  })

  it('moves to virtual Done by stripping statuses and setting completed', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing' })
    const taskInReady = task({ lists: [ios, ready] })

    const columns = getProjectBoardColumns([ios, ready, doing], projectId)
    const doneColumn = columns.find(column => column.id === VIRTUAL_DONE_COLUMN_ID)!
    const result = resolveProjectColumnMove(taskInReady, doneColumn, projectId, [ios, ready, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: true })
  })

  it('moves back to virtual Inbox by stripping statuses and clearing completed', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing' })
    const completedTask = task({ lists: [ios, doing], completed: true })

    const columns = getProjectBoardColumns([ios, doing], projectId)
    const inboxColumn = columns.find(column => column.id === VIRTUAL_INBOX_COLUMN_ID)!
    const result = resolveProjectColumnMove(completedTask, inboxColumn, projectId, [ios, doing])

    expect(result).toEqual({ listIds: ['ios'], completed: false })
  })

  it('normalizes direct list updates to one status per project and forces completed=false', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing' })

    expect(normalizeProjectStatusListIds(['ios', 'ready', 'doing'], [ios, ready, doing])).toEqual({
      listIds: ['ios', 'doing'],
      completedFromStatus: false,
    })
  })

  it('strips every project status when the task is being completed', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const ready = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })

    expect(
      normalizeProjectStatusListIds(['ios', 'ready'], [ios, ready], { completed: true }),
    ).toEqual({ listIds: ['ios'] })
  })

  it('does not auto-add a status when a project task is created without one', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const doing = list({ id: 'doing', name: 'Doing', projectId, listType: 'status', statusRole: 'doing', statusOrder: 1 })

    expect(normalizeProjectStatusListIds(['ios'], [ios, doing])).toEqual({
      listIds: ['ios'],
    })
  })

  it('getProjectDomainTasks only returns tasks attached to a regular project list', () => {
    const projectId = 'project-1'
    const ios = list({ id: 'ios', name: 'Astrid iOS To-do', projectId, listType: 'regular' })
    const otherProjectList = list({ id: 'web', name: 'Web', projectId: 'project-2', listType: 'regular' })
    const status = list({ id: 'ready', name: 'Ready', projectId, listType: 'status', statusRole: 'ready' })
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
