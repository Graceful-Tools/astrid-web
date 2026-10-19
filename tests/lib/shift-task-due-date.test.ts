/**
 * AWTD-1273 — the earlier/later/postpone keyboard shortcuts did nothing.
 *
 * They wrote the legacy `dueDate` field, which the v1 API never reads. They now
 * move `dueDateTime` through shiftTaskDueDate, which keeps the task's own day in
 * every zone: an all-day task (UTC midnight) moves by its UTC day, a timed task
 * by its local day at the same local time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { postponeTaskDueDate, shiftTaskDueDate } from '@/lib/date-comparison'

describe('AWTD-1273: shiftTaskDueDate', () => {
  let originalTZ: string | undefined
  beforeEach(() => { originalTZ = process.env.TZ })
  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    it(`AWTD-1273: an all-day task moves one day later in ${tz}`, () => {
      process.env.TZ = tz
      expect(shiftTaskDueDate(new Date('2026-11-02T00:00:00Z'), true, 1)).toEqual({
        dueDateTime: new Date('2026-11-03T00:00:00Z'), isAllDay: true,
      })
    })

    it(`AWTD-1273: an all-day task moves one day earlier in ${tz}`, () => {
      process.env.TZ = tz
      expect(shiftTaskDueDate(new Date('2026-11-02T00:00:00Z'), true, -1)).toEqual({
        dueDateTime: new Date('2026-11-01T00:00:00Z'), isAllDay: true,
      })
    })
  }

  it('AWTD-1273: a timed task keeps its local time across a DST change', () => {
    process.env.TZ = 'America/Los_Angeles'
    // 09:30 PDT on 31 Oct is 16:30Z; 09:30 PST on 1 Nov is 17:30Z.
    expect(shiftTaskDueDate(new Date('2026-10-31T16:30:00Z'), false, 1)).toEqual({
      dueDateTime: new Date('2026-11-01T17:30:00Z'), isAllDay: false,
    })
  })

  it('AWTD-1273: a task with no date starts from today, all-day', () => {
    process.env.TZ = 'America/Los_Angeles'
    // 22:00 PDT on 19 Oct is 05:00Z on the 20th — "today" is still the 19th.
    const now = new Date('2026-10-20T05:00:00Z')
    expect(shiftTaskDueDate(null, false, 1, now)).toEqual({
      dueDateTime: new Date('2026-10-20T00:00:00Z'), isAllDay: true,
    })
  })
})

describe('AWTD-1273: postponeTaskDueDate', () => {
  let originalTZ: string | undefined
  beforeEach(() => { originalTZ = process.env.TZ; process.env.TZ = 'America/Los_Angeles' })
  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })
  // 10:00 PDT on 19 Oct.
  const now = new Date('2026-10-19T17:00:00Z')

  it('AWTD-1273: a timed task lands a week from today at its own time', () => {
    // Due 15:00 PDT on 2 Oct (22:00Z); a week from 19 Oct is 26 Oct, 15:00 PDT = 22:00Z.
    expect(postponeTaskDueDate(new Date('2026-10-02T22:00:00Z'), false, now)).toEqual({
      dueDateTime: new Date('2026-10-26T22:00:00Z'), isAllDay: false,
    })
  })

  it('AWTD-1273: an all-day or undated task lands all-day a week from today', () => {
    const weekOut = { dueDateTime: new Date('2026-10-26T00:00:00Z'), isAllDay: true }
    expect(postponeTaskDueDate(new Date('2026-10-02T00:00:00Z'), true, now)).toEqual(weekOut)
    expect(postponeTaskDueDate(null, false, now)).toEqual(weekOut)
  })
})

describe('AWTD-1273: the controller writes dueDateTime, never the legacy dueDate', () => {
  it('AWTD-1273: no shortcut in useTaskManagerController sets `dueDate:`', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('hooks/useTaskManagerController.ts', 'utf8')
    expect(source).not.toMatch(/\.\.\.selectedTask,\s*dueDate\s*:/)
    expect(source).not.toMatch(/selectedTask\.dueDate\b/)
  })
})
