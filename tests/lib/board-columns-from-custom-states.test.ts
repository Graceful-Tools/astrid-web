/**
 * Custom board columns come from `Project.customStates` (task b346e377) — and
 * since Stage D (task b7b0c2f5) from nowhere else.
 *
 * Stage A gave custom states a durable home on the project and kept writing a
 * legacy `listType: 'status'` row alongside it, because the board built its
 * columns from those rows. This file used to test the MERGE of the two, across
 * three populations: boards written after Stage A (JSON + row), boards that
 * predated it (row only), and boards after the rows were dropped (JSON only).
 *
 * The rows are dropped. Only the third population exists, so there is no merge
 * left to get wrong — a column is a role and a name, and the project is the
 * only place either comes from. The merge tests went with the rows; what
 * remains is what still has to hold.
 */

import { describe, it, expect } from 'vitest'
import { getProjectBoardColumns } from '@/lib/project-status'

const names = (columns: { name: string }[]) => columns.map(c => c.name)
const customNames = (columns: { name: string }[]) =>
  names(columns).filter(n => !['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'].includes(n))

describe('custom columns from Project.customStates (task b346e377)', () => {
  it('renders a custom state', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(customNames(columns)).toEqual(['Blocked'])
  })

  it('keys the column on the role', () => {
    // The role is what a task carries in `statusRole`, so it is the only id
    // that can match a card to a column.
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(columns.find(c => c.name === 'Blocked')?.id).toBe('custom-blocked')
  })

  it('orders stored states by their own order', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-b', name: 'Second', order: 1 },
      { role: 'custom-a', name: 'First', order: 0 },
    ])

    expect(customNames(columns)).toEqual(['First', 'Second'])
  })

  it('keeps custom columns after the defaults and before Done', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(names(columns)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Blocked', 'Done'])
  })

  it('ignores a stored state that shadows a default role', () => {
    // Two columns called Ready is the duplication this model exists to remove.
    const columns = getProjectBoardColumns([{ role: 'ready', name: 'Ready', order: 0 }])

    expect(names(columns)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'])
  })

  it('ignores a duplicate role rather than rendering it twice', () => {
    const columns = getProjectBoardColumns([
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
      { role: 'custom-blocked', name: 'Blocked again', order: 1 },
    ])

    expect(customNames(columns)).toEqual(['Blocked'])
  })

  it('survives junk in the JSON column without throwing', () => {
    // A board must not go down because someone hand-edited a row.
    expect(() => getProjectBoardColumns('not an array' as never)).not.toThrow()
    expect(customNames(getProjectBoardColumns({ a: 1 } as never))).toEqual([])
  })

  it('renders the three defaults when no states are passed', () => {
    // The argument is optional and every caller that has no board must still
    // get a board.
    expect(names(getProjectBoardColumns())).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'])
  })
})
