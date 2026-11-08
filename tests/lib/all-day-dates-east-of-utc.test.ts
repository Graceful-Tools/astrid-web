/**
 * All-day dates for a user east of UTC, on purpose (2026-11-08).
 *
 * The main suite runs in UTC (vitest.config.ts). Before that it ran in the machine's
 * zone, so the only coverage users east of UTC had was a Mac that happened to be
 * there. This pins the moment those users are most exposed: Auckland at 09:00
 * Monday is still Sunday in UTC, so an all-day date (stored at UTC midnight of
 * its LOCAL calendar day) is a day "ahead" of the UTC clock. Every rule below
 * must read the local day, never the UTC one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTaskDueToday, isTaskOverdue } from '@/lib/date-filter-utils'
import { formatDateForDisplay } from '@/lib/date-utils'
import { parseTaskInput } from '@/lib/task-manager-utils'
import type { Task } from '@/types/task'

// Mon 9 Nov 2026, 09:00 in Auckland (NZDT, UTC+13) — Sun 8 Nov, 20:00 UTC.
const NOW = new Date('2026-11-08T20:00:00Z')
const allDay = (day: string) => ({ dueDateTime: `${day}T00:00:00.000Z`, isAllDay: true }) as unknown as Task

describe('all-day dates in Auckland, where the local day is ahead of UTC', () => {
  let originalTZ: string | undefined
  beforeEach(() => {
    originalTZ = process.env.TZ
    process.env.TZ = 'Pacific/Auckland'
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = originalTZ
  })

  it('a task due Monday is due today, not overdue', () => {
    expect(isTaskDueToday(allDay('2026-11-09'))).toBe(true)
    expect(isTaskOverdue(allDay('2026-11-09'))).toBe(false)
    expect(formatDateForDisplay(new Date('2026-11-09T00:00:00Z'), true)).toBe('Today')
  })

  it('a task due Sunday — still "today" in UTC — is yesterday, and overdue', () => {
    expect(isTaskDueToday(allDay('2026-11-08'))).toBe(false)
    expect(isTaskOverdue(allDay('2026-11-08'))).toBe(true)
    expect(formatDateForDisplay(new Date('2026-11-08T00:00:00Z'), true)).toBe('Yesterday')
  })

  it('a task due Tuesday is tomorrow, not today', () => {
    expect(isTaskDueToday(allDay('2026-11-10'))).toBe(false)
    expect(formatDateForDisplay(new Date('2026-11-10T00:00:00Z'), true)).toBe('Tomorrow')
  })

  it('quick-add "friday" lands on the local Friday', () => {
    const parsed = parseTaskInput('Gym friday', 'list-1', undefined, [], false, 'en')
    const due = new Date(parsed.dueDateTime!)
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getDay()]).toEqual([2026, 11, 13, 5])
  })
})
