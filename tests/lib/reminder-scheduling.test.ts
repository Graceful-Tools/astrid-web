import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeAutomaticReminders } from '@/lib/reminder-scheduling'

describe('reminder-scheduling — computeAutomaticReminders', () => {
  const fixedNow = new Date('2026-04-28T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty array for past due dates', () => {
    const past = new Date(fixedNow.getTime() - 60_000)
    expect(computeAutomaticReminders(past)).toEqual([])
  })

  it('schedules a 15-min-before due reminder + 1-hour-after overdue reminder for future dates', () => {
    const due = new Date(fixedNow.getTime() + 60 * 60 * 1000) // +1h
    const result = computeAutomaticReminders(due)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      scheduledFor: new Date(due.getTime() - 15 * 60 * 1000),
      type: 'due_reminder',
      source: 'automatic',
    })
    expect(result[1]).toEqual({
      scheduledFor: new Date(due.getTime() + 60 * 60 * 1000),
      type: 'overdue_reminder',
      source: 'automatic',
    })
  })

  it('falls back to due-time itself when due is less than 15min away', () => {
    const due = new Date(fixedNow.getTime() + 5 * 60 * 1000) // +5min
    const result = computeAutomaticReminders(due)

    expect(result[0].scheduledFor).toEqual(due)
    expect(result[0].type).toBe('due_reminder')
  })

  it('honors a custom source label', () => {
    const due = new Date(fixedNow.getTime() + 60 * 60 * 1000)
    const result = computeAutomaticReminders(due, 'automatic_update')
    expect(result.every(r => r.source === 'automatic_update')).toBe(true)
  })

  it('produces the same schedule whether called from POST-create or PUT-update flow', () => {
    // Regression test: POST and PUT routes both call this helper with the same
    // due date, so they should produce identical reminder rows. This is the
    // structural guarantee that the routes can't drift apart on reminder timing.
    const due = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000)

    const fromPost = computeAutomaticReminders(due, 'automatic')
    const fromPut = computeAutomaticReminders(due, 'automatic_update')

    expect(fromPost.map(r => ({ scheduledFor: r.scheduledFor, type: r.type })))
      .toEqual(fromPut.map(r => ({ scheduledFor: r.scheduledFor, type: r.type })))
  })
})
