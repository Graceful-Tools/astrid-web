/**
 * RED-first tests for AWTD-562 — status becomes a STATE on the task rather
 * than membership in a list.
 *
 * The list model could not hold two requirements at once, which is why the
 * same bug shipped twice:
 *   - one Ready/Doing/Waiting per user (or pickers fill with duplicates)
 *   - shared boards agree on a card's column (or collaborators disagree)
 *
 * A per-user list satisfies the first and breaks the second (Alice's Doing is
 * PRIVATE, so Bob resolves Inbox). A per-project list satisfies the second and
 * breaks the first. As a field on the shared task, both hold trivially.
 */

import { describe, it, expect } from 'vitest'
import {
  boardColumnsFor,
  taskColumnId,
  resolveColumnMove,
  parseCustomStates,
  DEFAULT_STATES,
  INBOX_COLUMN_ID,
  DONE_COLUMN_ID,
} from '@/lib/task-status'

const project = (customStates: unknown = null) => ({ id: 'p1', customStates })
const task = (over: Record<string, unknown> = {}) =>
  ({ id: 't1', completed: false, statusRole: null, ...over }) as never

describe('board columns come from config, not from lists (AWTD-562)', () => {
  it('is Inbox, the three defaults, then Done', () => {
    const columns = boardColumnsFor(project())
    expect(columns.map(c => c.id)).toEqual([INBOX_COLUMN_ID, 'ready', 'doing', 'waiting', DONE_COLUMN_ID])
  })

  it('cannot duplicate a column however many projects exist', () => {
    // The entire class of bug this replaces: columns are derived, so there is
    // no row to duplicate per project.
    const columns = boardColumnsFor(project())
    expect(new Set(columns.map(c => c.id)).size).toBe(columns.length)
  })

  it('appends a project\'s custom states after the defaults', () => {
    const columns = boardColumnsFor(project([{ role: 'blocked', name: 'Blocked', order: 0 }]))
    expect(columns.map(c => c.id)).toEqual([INBOX_COLUMN_ID, 'ready', 'doing', 'waiting', 'blocked', DONE_COLUMN_ID])
  })

  it('keeps one project\'s custom states off another project\'s board', () => {
    expect(boardColumnsFor(project()).map(c => c.id)).not.toContain('blocked')
  })
})

describe('every viewer resolves the same column (AWTD-562)', () => {
  it('REGRESSION for 142e4dd9: the column is a property of the TASK', () => {
    // No viewer argument exists, so Alice and Bob cannot disagree. This is the
    // bug that could not be fixed in the list model without duplicating lists.
    const card = task({ statusRole: 'doing' })
    expect(taskColumnId(card)).toBe('doing')
  })

  it('an unset status is Inbox', () => {
    expect(taskColumnId(task())).toBe(INBOX_COLUMN_ID)
  })

  it('completed wins over any status', () => {
    expect(taskColumnId(task({ completed: true, statusRole: 'doing' }))).toBe(DONE_COLUMN_ID)
  })

  it('a task holds at most one status by construction', () => {
    // It is a single field. There is no arrangement that puts a card in two
    // columns, which the list model needed a normalizer and a migration to enforce.
    const card = task({ statusRole: 'ready' })
    const columns = boardColumnsFor(project()).filter(c => taskColumnId(card) === c.id)
    expect(columns).toHaveLength(1)
  })
})

describe('moving a card (AWTD-562)', () => {
  it('to a status sets the role and clears completion', () => {
    expect(resolveColumnMove(task({ completed: true }), 'doing')).toEqual({ statusRole: 'doing', completed: false })
  })

  it('to Inbox clears the status', () => {
    expect(resolveColumnMove(task({ statusRole: 'doing' }), INBOX_COLUMN_ID)).toEqual({ statusRole: null, completed: false })
  })

  it('to Done completes and clears the status', () => {
    // Preserves the board invariant: completed implies no status.
    expect(resolveColumnMove(task({ statusRole: 'doing' }), DONE_COLUMN_ID)).toEqual({ statusRole: null, completed: true })
  })
})

describe('custom state config (AWTD-562)', () => {
  it('parses a well-formed config', () => {
    expect(parseCustomStates([{ role: 'blocked', name: 'Blocked', order: 1 }]))
      .toEqual([{ role: 'blocked', name: 'Blocked', order: 1 }])
  })

  it('ignores junk rather than breaking a board', () => {
    // A malformed config must never take the board down.
    expect(parseCustomStates('nonsense')).toEqual([])
    expect(parseCustomStates(null)).toEqual([])
    expect(parseCustomStates([{ name: 'no role' }])).toEqual([])
  })

  it('returns default-role entries as overrides (per-board renamed built-ins)', () => {
    // Default roles in customStates are now allowed as name/order overrides,
    // e.g. renaming "Ready" to "Starting" stores { role: 'ready', name: 'Starting' }.
    const result = parseCustomStates([{ role: 'doing', name: 'Doing Again', order: 1 }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ role: 'doing', name: 'Doing Again' })
  })

  it('deduplicates and orders custom states', () => {
    const parsed = parseCustomStates([
      { role: 'b', name: 'B', order: 2 },
      { role: 'a', name: 'A', order: 1 },
      { role: 'b', name: 'B dup', order: 3 },
    ])
    expect(parsed.map(s => s.role)).toEqual(['a', 'b'])
  })

  it('exposes the defaults as data, not as rows', () => {
    expect(DEFAULT_STATES.map(s => s.role)).toEqual(['ready', 'doing', 'waiting'])
  })
})
