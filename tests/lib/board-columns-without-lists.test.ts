/**
 * The board survives the status lists going away (task a1722040, step 4).
 *
 * Steps 3 and 4 — deleting the `listType:'status'` rows and building columns
 * from config — are gated on iOS adoption: phones on older builds still resolve
 * columns from membership, so deleting the rows early breaks their boards.
 *
 * What is NOT gated is web ceasing to *depend* on those rows. Today
 * `getProjectBoardColumns` derives the whole board from them, so the day they
 * are dropped the board renders Inbox and Done and nothing else. These tests
 * pin the end state now, so the eventual deletion is a no-op for web rather
 * than a cliff.
 */

import { describe, it, expect } from 'vitest'
import {
  getProjectBoardColumns,
  getTaskProjectColumnId,
  resolveProjectColumnMove,
  VIRTUAL_INBOX_COLUMN_ID,
} from '@/lib/project-status'

const PROJECT = 'p1'

const domainList = {
  id: 'domain-1', name: 'Work', listType: 'list', projectId: PROJECT, privacy: 'SHARED',
} as never

const statusList = (role: string, id: string, name: string, order = 0) => ({
  id, name, listType: 'status', statusRole: role, statusOrder: order,
  projectId: null, privacy: 'PRIVATE',
}) as never

const taskWith = (statusRole: string | null, listIds: string[] = ['domain-1']) => ({
  id: 't1', completed: false, statusRole,
  lists: listIds.map(id => ({ id })),
}) as never

describe('board columns without any status lists (task a1722040)', () => {
  it('still renders the three default columns', () => {
    const columns = getProjectBoardColumns([domainList], PROJECT)

    expect(columns.map(c => c.name)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'])
  })

  it('places a card by its role alone, with no membership and no lists', () => {
    const columns = getProjectBoardColumns([domainList], PROJECT)
    const doing = columns.find(c => c.name === 'Doing')!

    expect(getTaskProjectColumnId(taskWith('doing'), [domainList], PROJECT)).toBe(doing.id)
  })

  it('keeps Inbox for a task with no role', () => {
    expect(getTaskProjectColumnId(taskWith(null), [domainList], PROJECT)).toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('writes the role and adds no phantom list membership on a move', () => {
    // The column id is the role when nothing backs it. Appending that to
    // listIds would persist a membership in a list that does not exist.
    const columns = getProjectBoardColumns([domainList], PROJECT)
    const doing = columns.find(c => c.name === 'Doing')!

    const move = resolveProjectColumnMove(taskWith(null), doing, [domainList])

    expect(move.statusRole).toBe('doing')
    expect(move.listIds).toEqual(['domain-1'])
  })
})

describe('board columns while the status lists still exist', () => {
  const ready = statusList('ready', 'l-ready', 'Ready', 0)
  const lists = [domainList, ready]

  it('still keys the column on the backing list, so the dual-write keeps working', () => {
    const columns = getProjectBoardColumns(lists, PROJECT)
    const readyColumn = columns.find(c => c.name === 'Ready')!

    expect(readyColumn.id).toBe('l-ready')
    expect(readyColumn.statusList).toBeDefined()
  })

  it('still appends the membership on a move, for clients that read it', () => {
    const columns = getProjectBoardColumns(lists, PROJECT)
    const readyColumn = columns.find(c => c.name === 'Ready')!

    const move = resolveProjectColumnMove(taskWith(null), readyColumn, lists)

    expect(move.statusRole).toBe('ready')
    expect(move.listIds).toEqual(['domain-1', 'l-ready'])
  })

  it('prefers the list name when the user has renamed a default status', () => {
    // Rename is a PUT on the list, so a renamed default must not revert to the
    // config's label while the rows still exist.
    const renamed = { ...(statusList('ready', 'l-ready', 'Backlog', 0) as object) } as never
    const columns = getProjectBoardColumns([domainList, renamed], PROJECT)

    expect(columns.map(c => c.name)).toEqual(['Inbox', 'Backlog', 'Doing', 'Waiting', 'Done'])
  })

  it('keeps a project custom state alongside the defaults', () => {
    const custom = {
      id: 'l-blocked', name: 'Blocked', listType: 'status', statusRole: 'custom-blocked',
      statusOrder: 5, projectId: PROJECT, privacy: 'PRIVATE',
    } as never

    const columns = getProjectBoardColumns([domainList, custom], PROJECT)

    expect(columns.map(c => c.name)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Blocked', 'Done'])
  })
})
