/**
 * `resolveCreateDateFields` — the create path's dates, extracted (AWTD-1218).
 *
 * The extraction that made room under the oversized-files ratchet for
 * `resolveStatusRoleWrite` to return a 400. It moved whole, so these tests are
 * really about one thing: that it still behaves exactly as the inline block did.
 * Each case below is a rule the block already enforced.
 */

import { describe, it, expect } from 'vitest'
import { resolveCreateDateFields } from '@/services/task-dates'

const ok = (input: Parameters<typeof resolveCreateDateFields>[0]) => {
  const result = resolveCreateDateFields(input)
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.data
}

describe('resolveCreateDateFields (AWTD-1218)', () => {
  it('takes dueDateTime when both it and `when` are given', () => {
    const data = ok({ dueDateTime: '2026-11-01T15:30:00.000Z', when: '2026-12-25' })
    expect(data.dueDateTime?.toISOString()).toBe('2026-11-01T15:30:00.000Z')
    // A timed due date is not all-day, so the time survives.
    expect(data.isAllDay).toBe(false)
  })

  it('falls back to `when`, which has always meant an all-day date', () => {
    const data = ok({ when: '2026-12-25T18:00:00.000Z' })
    expect(data.isAllDay).toBe(true)
    // Midnight UTC: an all-day task carrying a stray time renders on different
    // days for two clients in different zones, which all-day exists to prevent.
    expect(data.dueDateTime?.toISOString()).toBe('2026-12-25T00:00:00.000Z')
  })

  it('lets an explicit isAllDay win over the `when` inference', () => {
    const data = ok({ when: '2026-12-25', isAllDay: false })
    expect(data.isAllDay).toBe(false)
    expect(data.dueDateTime?.toISOString()).toBe('2026-12-25T00:00:00.000Z')
  })

  it('flattens a timed due date to midnight when isAllDay is asked for', () => {
    const data = ok({ dueDateTime: '2026-11-01T15:30:00.000Z', isAllDay: true })
    expect(data.dueDateTime?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it("treats `when: 'none'` as clearing it, not as a date", () => {
    const data = ok({ when: 'none' })
    expect(data.dueDateTime).toBeNull()
    expect(data.isAllDay).toBe(false)
  })

  it('carries the reminder through', () => {
    expect(ok({ reminderTime: '2026-11-01T09:00:00.000Z' }).reminderTime?.toISOString()).toBe(
      '2026-11-01T09:00:00.000Z',
    )
  })

  it('returns nulls when nothing is given, rather than refusing', () => {
    expect(ok({})).toEqual({ dueDateTime: null, isAllDay: false, reminderTime: null })
  })

  it.each([
    ['dueDateTime', { dueDateTime: 'not a date' }, 'Invalid dueDateTime format'],
    ['when', { when: 'not a date' }, 'Invalid date format'],
    ['reminderTime', { reminderTime: 'not a date' }, 'Invalid reminderTime format'],
  ])('refuses an unparseable %s with a 400 naming it', (_field, input, message) => {
    const result = resolveCreateDateFields(input)
    expect(result).toMatchObject({ ok: false, status: 400 })
    if (!result.ok) expect(result.error).toContain(message)
  })

  it('refuses the FIRST bad field, so the message names what the caller sent', () => {
    const result = resolveCreateDateFields({ dueDateTime: 'bad', when: 'also bad' })
    if (result.ok) throw new Error('expected a refusal')
    expect(result.error).toContain('Invalid dueDateTime format')
  })
})
