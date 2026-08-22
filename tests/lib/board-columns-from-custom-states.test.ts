/**
 * Custom board columns come from `Project.customStates` (task b346e377).
 *
 * Stage A gave custom states a durable home on the project and kept writing
 * the legacy `listType: 'status'` row alongside it, because the board built
 * its columns from those rows. This is the reader half: once the board reads
 * the project, the rows are droppable.
 *
 * THE MERGE IS THE WHOLE JOB, and it has to satisfy three populations at once:
 *
 *   1. boards created after Stage A — state in JSON *and* a backing row;
 *   2. boards that predate it — a row and no JSON;
 *   3. boards after the rows are dropped — JSON and no row.
 *
 * (1) is where a duplicate column comes from if the merge keys off anything
 * but the role, and a duplicate column is worse than either source alone: two
 * headers with the same name, and a card that can only be in one of them.
 *
 * The column id stays the LIST id while a row backs the role. The membership
 * dual-write keys off that id, so switching it to the role early would send
 * drops to a list that does not exist.
 */

import { describe, it, expect } from 'vitest'
import { getProjectBoardColumns } from '@/lib/project-status'

const PROJECT = 'p1'

const domainList = {
  id: 'domain-1', name: 'Work', listType: 'list', projectId: PROJECT, privacy: 'SHARED',
} as never

/** A legacy custom column: a project-scoped status row. */
const customRow = (role: string, id: string, name: string, order = 10) => ({
  id, name, listType: 'status', statusRole: role, statusOrder: order,
  projectId: PROJECT, privacy: 'PRIVATE',
}) as never

const names = (columns: { name: string }[]) => columns.map(c => c.name)
const customNames = (columns: { name: string }[]) =>
  names(columns).filter(n => !['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'].includes(n))

describe('custom columns from Project.customStates (task b346e377)', () => {
  it('renders a custom state that has no backing row', () => {
    // The end state: rows dropped, JSON only.
    const columns = getProjectBoardColumns([domainList], PROJECT, [
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(customNames(columns)).toEqual(['Blocked'])
  })

  it('keys the column on the role when no row backs it', () => {
    const columns = getProjectBoardColumns([domainList], PROJECT, [
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(columns.find(c => c.name === 'Blocked')?.id).toBe('custom-blocked')
  })

  it('does NOT duplicate a state that also has a backing row', () => {
    // Population (1): everything Stage A wrote. Merging on anything but the
    // role puts two "Blocked" headers on the board.
    const columns = getProjectBoardColumns(
      [domainList, customRow('custom-blocked', 'list-9', 'Blocked')],
      PROJECT,
      [{ role: 'custom-blocked', name: 'Blocked', order: 0 }],
    )

    expect(customNames(columns), 'the same column rendered twice').toEqual(['Blocked'])
  })

  it('keeps the LIST id while a row backs the role', () => {
    // The membership dual-write targets this id. Switching to the role while
    // rows still exist sends drops at a list that does not exist.
    const columns = getProjectBoardColumns(
      [domainList, customRow('custom-blocked', 'list-9', 'Blocked')],
      PROJECT,
      [{ role: 'custom-blocked', name: 'Blocked', order: 0 }],
    )

    expect(columns.find(c => c.id === 'list-9')).toBeDefined()
  })

  it('prefers the stored name over the row when they disagree', () => {
    // The project is the durable copy; the row is transitional.
    const columns = getProjectBoardColumns(
      [domainList, customRow('custom-blocked', 'list-9', 'Stale name')],
      PROJECT,
      [{ role: 'custom-blocked', name: 'Waiting on legal', order: 0 }],
    )

    expect(customNames(columns)).toEqual(['Waiting on legal'])
  })

  it('still renders a legacy row that has no stored state', () => {
    // Population (2): boards whose customs predate the writer. Dropping these
    // would silently remove columns people are using.
    const columns = getProjectBoardColumns(
      [domainList, customRow('custom-legacy', 'list-8', 'Legacy')],
      PROJECT,
      [],
    )

    expect(customNames(columns)).toEqual(['Legacy'])
  })

  it('renders both a stored state and an unmigrated row, once each', () => {
    const columns = getProjectBoardColumns(
      [domainList, customRow('custom-legacy', 'list-8', 'Legacy')],
      PROJECT,
      [{ role: 'custom-blocked', name: 'Blocked', order: 0 }],
    )

    expect(customNames(columns).sort()).toEqual(['Blocked', 'Legacy'])
  })

  it('orders stored states by their own order', () => {
    const columns = getProjectBoardColumns([domainList], PROJECT, [
      { role: 'custom-b', name: 'Second', order: 1 },
      { role: 'custom-a', name: 'First', order: 0 },
    ])

    expect(customNames(columns)).toEqual(['First', 'Second'])
  })

  it('keeps custom columns after the defaults and before Done', () => {
    const columns = getProjectBoardColumns([domainList], PROJECT, [
      { role: 'custom-blocked', name: 'Blocked', order: 0 },
    ])

    expect(names(columns)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Blocked', 'Done'])
  })

  it('ignores a stored state that shadows a default role', () => {
    // Two columns called Ready is the duplication this model exists to remove.
    const columns = getProjectBoardColumns([domainList], PROJECT, [
      { role: 'ready', name: 'Ready', order: 0 },
    ])

    expect(names(columns)).toEqual(['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'])
  })

  it('survives junk in the JSON column without throwing', () => {
    // A board must not go down because someone hand-edited a row.
    expect(() => getProjectBoardColumns([domainList], PROJECT, 'not an array' as never)).not.toThrow()
    expect(customNames(getProjectBoardColumns([domainList], PROJECT, { a: 1 } as never))).toEqual([])
  })

  it('behaves exactly as before when no states are passed', () => {
    // Every existing caller omits the argument; none of them may change.
    const withArg = getProjectBoardColumns([domainList, customRow('custom-x', 'list-7', 'X')], PROJECT)
    expect(customNames(withArg)).toEqual(['X'])
  })
})
