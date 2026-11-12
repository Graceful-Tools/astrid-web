/**
 * AWTD-1583: a saved filter whose due-date window was retired ("tomorrow", the calendar week or
 * month — astrid-core D35) keeps working. It reads as the nearest window every client has, rather
 * than as an unknown value (which would show every dated task).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTask } from '../fixtures/domain'
import { applyVirtualListFilter } from '@/lib/virtual-list-utils'
import type { TaskList } from '@/types/task'

const savedFilter = (filterDueDate: string) => ({ id: 'saved', name: 'Saved', isVirtual: true, filterDueDate }) as unknown as TaskList

const tasks = [
  buildTask({ id: 'in-3-days', isAllDay: true, dueDateTime: new Date('2026-09-12T00:00:00.000Z') }),
  buildTask({ id: 'in-20-days', isAllDay: true, dueDateTime: new Date('2026-09-29T00:00:00.000Z') }),
  buildTask({ id: 'in-60-days', isAllDay: true, dueDateTime: new Date('2026-11-08T00:00:00.000Z') }),
  buildTask({ id: 'undated', dueDateTime: null }),
]

describe('AWTD-1583: saved filters with a retired due-date window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T10:30:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  const shown = (window: string) => applyVirtualListFilter(tasks, savedFilter(window), 'u1').map((t) => t.id)

  it('"tomorrow" and "this calendar week" read as the next 7 days', () => {
    expect(shown('tomorrow')).toEqual(['in-3-days'])
    expect(shown('this_calendar_week')).toEqual(['in-3-days'])
  })

  it('"this calendar month" reads as the next 30 days', () => {
    expect(shown('this_calendar_month')).toEqual(['in-3-days', 'in-20-days'])
  })
})
