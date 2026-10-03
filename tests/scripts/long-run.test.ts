/**
 * AWTD-1041: tasks that need longer than the scheduled loop's 75-minute watchdog.
 *
 * A task says so with a `LONG-RUN` line in its description (8h, or
 * `LONG-RUN: 3h` / `LONG-RUN: 90m`). The wrapper sizes the run's watchdog from
 * the task it is about to work, and only STARTS a long run inside the long-run
 * window — outside it the task is deferred and the rest of the queue is worked.
 */
import { describe, it, expect } from 'vitest'

import {
  LONG_RUN_MAX_MINUTES,
  parseLongRun,
  parseLongRunWindow,
  planRun,
} from '../../scripts/lib/long-run'

const task = (id: string, description = '') => ({ id, identifier: id.toUpperCase(), title: id, description })

describe('parseLongRun (AWTD-1041)', () => {
  it('reads a bare LONG-RUN line as the 8-hour maximum', () => {
    expect(parseLongRun('Refactor everything.\n\nLONG-RUN\n')).toBe(480)
    expect(LONG_RUN_MAX_MINUTES).toBe(480)
  })

  it('reads hours and minutes', () => {
    expect(parseLongRun('LONG-RUN: 3h')).toBe(180)
    expect(parseLongRun('long-run: 90m')).toBe(90)
    expect(parseLongRun('LONG-RUN: 2.5 hours')).toBe(150)
    expect(parseLongRun('LONG-RUN: 120 minutes')).toBe(120)
  })

  it('caps at the maximum rather than trusting any number', () => {
    expect(parseLongRun('LONG-RUN: 24h')).toBe(480)
  })

  it('treats an unreadable amount as the maximum, never as "not long"', () => {
    expect(parseLongRun('LONG-RUN: all night')).toBe(480)
  })

  it('ignores the words in prose — the marker must be its own line', () => {
    expect(parseLongRun('This is a long-run task in spirit')).toBeNull()
    expect(parseLongRun('')).toBeNull()
    expect(parseLongRun(null)).toBeNull()
    expect(parseLongRun(undefined)).toBeNull()
  })
})

describe('parseLongRunWindow (AWTD-1041)', () => {
  it('parses a wrapping overnight window', () => {
    expect(parseLongRunWindow('22-6')).toEqual({ start: 22, end: 6 })
  })

  it('accepts "always"', () => {
    expect(parseLongRunWindow('always')).toEqual({ start: 0, end: 24 })
  })

  it('refuses nonsense rather than guessing', () => {
    expect(parseLongRunWindow('late')).toBeNull()
    expect(parseLongRunWindow('25-3')).toBeNull()
  })
})

describe('planRun (AWTD-1041)', () => {
  const window = { start: 22, end: 6 }
  const base = { defaultMinutes: 75, window, maxTasks: 1 }

  it('keeps the default watchdog when nothing is flagged', () => {
    const plan = planRun({ ...base, queue: [task('a'), task('b')], hour: 14 })
    expect(plan.maxMinutes).toBe(75)
    expect(plan.long).toBe(false)
    expect(plan.deferred).toEqual([])
    expect(plan.nextTask?.id).toBe('a')
  })

  it('defers a long task outside the window and works the rest', () => {
    const plan = planRun({ ...base, queue: [task('long', 'LONG-RUN'), task('short')], hour: 14 })
    expect(plan.deferred.map(t => t.id)).toEqual(['long'])
    expect(plan.nextTask?.id).toBe('short')
    expect(plan.maxMinutes).toBe(75)
    expect(plan.queue.map(t => t.id)).toEqual(['short'])
  })

  it('leaves nothing to work when the only task is long and the window is shut', () => {
    const plan = planRun({ ...base, queue: [task('long', 'LONG-RUN')], hour: 9 })
    expect(plan.queue).toEqual([])
    expect(plan.nextTask).toBeNull()
    expect(plan.note).toMatch(/22:00/)
  })

  it('inside the window, takes the long task FIRST and sizes the watchdog for it', () => {
    const plan = planRun({ ...base, queue: [task('short'), task('long', 'LONG-RUN: 3h')], hour: 23 })
    expect(plan.nextTask?.id).toBe('long')
    expect(plan.long).toBe(true)
    expect(plan.maxMinutes).toBe(180)
    expect(plan.deferred).toEqual([])
  })

  it('treats the small hours as inside a wrapping window', () => {
    const plan = planRun({ ...base, queue: [task('long', 'LONG-RUN')], hour: 3 })
    expect(plan.nextTask?.id).toBe('long')
    expect(plan.maxMinutes).toBe(480)
  })

  it('the window end is exclusive — 06:00 is outside 22-6', () => {
    const plan = planRun({ ...base, queue: [task('long', 'LONG-RUN')], hour: 6 })
    expect(plan.nextTask).toBeNull()
  })

  it('a flag shorter than the default is not a long run', () => {
    const plan = planRun({ ...base, queue: [task('a', 'LONG-RUN: 30m')], hour: 12 })
    expect(plan.long).toBe(false)
    expect(plan.maxMinutes).toBe(75)
    expect(plan.deferred).toEqual([])
  })
})
