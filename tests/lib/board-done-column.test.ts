/**
 * The board's Done column: newest completion on top, and a completed-on pill
 * under each card's title (Jon, 2026-11-19 — shared with iOS, Mac, Windows,
 * Android and astrid-core PR #93).
 */
import { describe, expect, it } from 'vitest'
import {
  doneCompletionDate,
  completedOnDay,
  formatCompletedOnLabel,
  sortDoneColumnTasks,
} from '@/lib/board-done-column'

type T = { id: string; completedAt?: Date | string | null; updatedAt?: Date | string | null }

const ids = (tasks: T[]) => tasks.map(task => task.id)

describe('doneCompletionDate', () => {
  it('prefers completedAt', () => {
    const date = doneCompletionDate({ completedAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-20T10:00:00Z' })
    expect(date?.toISOString()).toBe('2026-11-19T10:00:00.000Z')
  })

  it('falls back to updatedAt when completedAt is missing', () => {
    const date = doneCompletionDate({ completedAt: null, updatedAt: new Date('2026-11-18T08:00:00Z') })
    expect(date?.toISOString()).toBe('2026-11-18T08:00:00.000Z')
  })

  it('is null when neither is a real date', () => {
    expect(doneCompletionDate({})).toBeNull()
    expect(doneCompletionDate({ completedAt: 'not a date' })).toBeNull()
  })
})

describe('sortDoneColumnTasks', () => {
  it('puts the most recently completed on top', () => {
    const tasks: T[] = [
      { id: 'old', completedAt: '2026-11-01T00:00:00Z' },
      { id: 'newest', completedAt: '2026-11-19T00:00:00Z' },
      { id: 'middle', completedAt: '2026-11-10T00:00:00Z' },
    ]
    expect(ids(sortDoneColumnTasks(tasks))).toEqual(['newest', 'middle', 'old'])
  })

  it('uses updatedAt for a task with no completedAt', () => {
    const tasks: T[] = [
      { id: 'completed-early', completedAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-30T00:00:00Z' },
      { id: 'legacy-updated-late', completedAt: null, updatedAt: '2026-11-15T00:00:00Z' },
    ]
    expect(ids(sortDoneColumnTasks(tasks))).toEqual(['legacy-updated-late', 'completed-early'])
  })

  it('keeps the incoming order for ties, and undated tasks last', () => {
    const tasks: T[] = [
      { id: 'undated-a' },
      { id: 'tie-1', completedAt: '2026-11-05T00:00:00Z' },
      { id: 'undated-b' },
      { id: 'tie-2', completedAt: '2026-11-05T00:00:00Z' },
      { id: 'newest', completedAt: '2026-11-06T00:00:00Z' },
    ]
    expect(ids(sortDoneColumnTasks(tasks))).toEqual(['newest', 'tie-1', 'tie-2', 'undated-a', 'undated-b'])
  })

  it('does not mutate its input', () => {
    const tasks: T[] = [
      { id: 'a', completedAt: '2026-11-01T00:00:00Z' },
      { id: 'b', completedAt: '2026-11-02T00:00:00Z' },
    ]
    sortDoneColumnTasks(tasks)
    expect(ids(tasks)).toEqual(['a', 'b'])
  })
})

describe('completedOnDay', () => {
  it('is the local calendar day, as YYYY-MM-DD (core rows carry the same `completedOn`)', () => {
    expect(completedOnDay(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19')
    expect(completedOnDay(new Date(2026, 0, 3, 0, 1))).toBe('2026-01-03')
  })
})

describe('formatCompletedOnLabel', () => {
  const now = new Date(2026, 10, 19, 12, 0)

  it('is month and day this year', () => {
    expect(formatCompletedOnLabel(new Date(2026, 10, 19, 9, 0), 'en', now)).toBe('Nov 19')
    expect(formatCompletedOnLabel(new Date(2026, 0, 2, 9, 0), 'en', now)).toBe('Jan 2')
  })

  it('adds the year when it is not the current year', () => {
    expect(formatCompletedOnLabel(new Date(2025, 10, 19, 9, 0), 'en', now)).toBe('Nov 19, 2025')
  })

  it("speaks the reader's locale", () => {
    const date = new Date(2026, 10, 19, 9, 0)
    expect(formatCompletedOnLabel(date, 'de', now)).toBe(
      new Intl.DateTimeFormat('de', { month: 'short', day: 'numeric' }).format(date),
    )
  })
})
