/**
 * The LIST view's row status picker must offer the same columns as the BOARD
 * (task 9ddf4a6f).
 *
 * Task 036ef139 wired the row picker through `getBoardRowContext`, so both
 * surfaces would derive their columns from one helper. But that helper called
 * `getProjectBoardColumns(lists, projectId)` with two arguments, and Stage B
 * (task b346e377) had given it a third — the project's `customStates`, the
 * durable home for custom columns. Omitting it is not neutral: only LEGACY
 * row-backed customs survive, so a board whose custom states live in JSON
 * rendered them in board view and NOT in the row picker. The two surfaces
 * disagreeing about one board's columns is exactly what routing the picker
 * through the board's helper was supposed to prevent.
 *
 * It type-checked, and the picker's own test passed, because that test's
 * custom column is backed by a legacy status row — the population that
 * predates the writer, which renders correctly with or without the fix. The
 * fixture below deliberately has NO backing row, which is also the end state
 * once Stage D drops the rows: without this, the row picker would lose custom
 * states entirely the day they are deleted.
 */

import { describe, it, expect } from 'vitest'
import { getBoardRowContext } from '@/lib/project-status'

const PROJECT = 'p1'

const domainList = {
  id: 'domain-1', name: 'Work', listType: 'list', projectId: PROJECT, privacy: 'SHARED',
} as never

/** A legacy custom column: a project-scoped status row. */
const customRow = {
  id: 'list-9', name: 'Blocked', listType: 'status', statusRole: 'custom-blocked',
  statusOrder: 10, projectId: PROJECT, privacy: 'PRIVATE',
} as never

const CUSTOM_STATES = [{ role: 'custom-blocked', name: 'Blocked', order: 0 }]

const customNames = (columns: { name: string }[]) =>
  columns.map(c => c.name).filter(n => !['Inbox', 'Ready', 'Doing', 'Waiting', 'Done'].includes(n))

describe('getBoardRowContext custom columns (task 9ddf4a6f)', () => {
  it('offers a custom state that has no backing row', () => {
    const context = getBoardRowContext([domainList], 'domain-1', CUSTOM_STATES)

    expect(customNames(context!.columns)).toEqual(['Blocked'])
  })

  it('keys that column on the role, since no row backs it', () => {
    const context = getBoardRowContext([domainList], 'domain-1', CUSTOM_STATES)

    expect(context!.columns.find(c => c.name === 'Blocked')?.id).toBe('custom-blocked')
  })

  it('renders the same columns the board does, JSON and row together', () => {
    // Population (1) from Stage B: state in JSON *and* a backing row. The row
    // picker must show one "Blocked", not two, and must key it on the LIST id
    // while the row exists — the membership dual-write targets that id.
    const context = getBoardRowContext([domainList, customRow], 'domain-1', CUSTOM_STATES)

    expect(customNames(context!.columns)).toEqual(['Blocked'])
    expect(context!.columns.find(c => c.name === 'Blocked')?.id).toBe('list-9')
  })

  it('still renders a legacy row-backed custom when no states are passed', () => {
    // The pre-Stage-B population, and the in-flight case: the hook returns
    // undefined until the request lands, and that must leave the picker exactly
    // as it is today rather than emptying it.
    const context = getBoardRowContext([domainList, customRow], 'domain-1', undefined)

    expect(customNames(context!.columns)).toEqual(['Blocked'])
  })

  it('is null for a list with no board at all', () => {
    const orphan = { id: 'solo', name: 'Solo', listType: 'list', privacy: 'PRIVATE' } as never

    expect(getBoardRowContext([orphan], 'solo', CUSTOM_STATES)).toBeNull()
  })
})
