/**
 * The board is built from config, not from rows (task a1722040 step 4,
 * completed by Stage D — task b7b0c2f5).
 *
 * These tests were written while the `listType: 'status'` rows still existed,
 * to pin the end state ahead of the deletion so it would be a no-op for web
 * rather than a cliff. The rows are gone now, so what was "the end state" is
 * simply the behaviour, and the companion `describe` that pinned the
 * transitional dual-write has been deleted with the thing it described.
 */

import { describe, it, expect } from 'vitest'
import {
  getProjectBoardColumns,
  getTaskProjectColumnId,
  resolveProjectColumnMove,
  VIRTUAL_INBOX_COLUMN_ID,
} from '@/lib/project-status'

const domainList = {
  id: 'domain-1', name: 'Work', listType: 'regular', projectId: 'p1', privacy: 'SHARED',
} as never

const taskWith = (statusRole: string | null, listIds: string[] = ['domain-1']) => ({
  id: 't1', completed: false, statusRole,
  lists: listIds.map(id => ({ id })),
}) as never

describe('board columns come from config (task a1722040)', () => {
  it('renders the three default columns with no lists at all', () => {
    const columns = getProjectBoardColumns()

    expect(columns.map(c => c.name)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'])
  })

  it('places a card by its role alone', () => {
    const columns = getProjectBoardColumns()
    const doing = columns.find(c => c.name === 'Doing')!

    expect(getTaskProjectColumnId(taskWith('doing'), columns)).toBe(doing.id)
  })

  it('keeps Inbox for a task with no role', () => {
    expect(getTaskProjectColumnId(taskWith(null), getProjectBoardColumns()))
      .toBe(VIRTUAL_INBOX_COLUMN_ID)
  })

  it('writes the role and adds no phantom list membership on a move', () => {
    // The column id IS the role. Appending it to listIds would persist a
    // membership in a list that does not exist.
    const doing = getProjectBoardColumns().find(c => c.name === 'Doing')!

    const move = resolveProjectColumnMove(taskWith(null), doing, [domainList])

    expect(move.statusRole).toBe('doing')
    expect(move.listIds).toEqual(['domain-1'])
  })

  it('keeps a board custom state alongside the defaults', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', description: '', order: 0 },
    ])

    expect(columns.map(c => c.name)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Blocked', 'Done'])
  })
})
