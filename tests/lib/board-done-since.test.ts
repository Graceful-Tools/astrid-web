/**
 * The Done column's period (ADEV-133, web half of ADEV-131; iOS + Mac shipped it).
 * Presets roll with the clock, a picked date stays fixed from the start of that
 * day, the week is Monday–Sunday, and a card's time is completedAt else updatedAt.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DONE_SINCE,
  doneSinceCutoff,
  doneSinceStorageKey,
  filterDoneSince,
  formatDoneSinceLabelKey,
  parseDoneSince,
} from '@/lib/board-done-since'

// Thursday 19 Nov 2026, local noon.
const now = new Date(2026, 10, 19, 12, 0, 0)

describe('doneSinceCutoff', () => {
  it('today starts at local midnight', () => {
    expect(doneSinceCutoff({ kind: 'today' }, now)).toEqual(new Date(2026, 10, 19))
  })
  it('this week starts on Monday', () => {
    expect(doneSinceCutoff({ kind: 'this_week' }, now)).toEqual(new Date(2026, 10, 16))
    // Sunday belongs to the week that began the Monday before.
    expect(doneSinceCutoff({ kind: 'this_week' }, new Date(2026, 10, 22, 9))).toEqual(new Date(2026, 10, 16))
    expect(doneSinceCutoff({ kind: 'this_week' }, new Date(2026, 10, 16, 0, 0, 1))).toEqual(new Date(2026, 10, 16))
  })
  it('this month and this year', () => {
    expect(doneSinceCutoff({ kind: 'this_month' }, now)).toEqual(new Date(2026, 10, 1))
    expect(doneSinceCutoff({ kind: 'this_year' }, now)).toEqual(new Date(2026, 0, 1))
  })
  it('a picked date stays fixed, from the start of that day', () => {
    expect(doneSinceCutoff({ kind: 'date', date: '2025-11-01' }, now)).toEqual(new Date(2025, 10, 1))
  })
  it('all time has no cutoff', () => {
    expect(doneSinceCutoff({ kind: 'all_time' }, now)).toBeNull()
  })
})

describe('filterDoneSince', () => {
  const tasks: { id: string; completedAt?: string | null; updatedAt?: string | null }[] = [
    { id: 'new', completedAt: '2026-11-18T10:00:00' },
    { id: 'old', completedAt: '2026-10-01T10:00:00' },
    { id: 'fallback', completedAt: null, updatedAt: '2026-11-17T10:00:00' },
    { id: 'undated' },
  ]
  it('keeps cards on or after the cutoff, using completedAt else updatedAt', () => {
    expect(filterDoneSince(tasks, { kind: 'this_week' }, now).map(t => t.id)).toEqual(['new', 'fallback'])
    expect(filterDoneSince(tasks, { kind: 'this_month' }, now).map(t => t.id)).toEqual(['new', 'fallback'])
  })
  it('all time keeps every card', () => {
    expect(filterDoneSince(tasks, { kind: 'all_time' }, now)).toHaveLength(4)
  })
})

describe('storage', () => {
  it('is saved per user and per list', () => {
    expect(doneSinceStorageKey('u1', 'l1')).not.toBe(doneSinceStorageKey('u1', 'l2'))
    expect(doneSinceStorageKey('u1', 'l1')).not.toBe(doneSinceStorageKey('u2', 'l1'))
  })
  it('defaults to this week and survives garbage', () => {
    expect(DEFAULT_DONE_SINCE).toEqual({ kind: 'this_week' })
    expect(parseDoneSince(null)).toEqual(DEFAULT_DONE_SINCE)
    expect(parseDoneSince('{nope')).toEqual(DEFAULT_DONE_SINCE)
    expect(parseDoneSince('{"kind":"date","date":"bad"}')).toEqual(DEFAULT_DONE_SINCE)
    expect(parseDoneSince('{"kind":"date","date":"2026-11-01"}')).toEqual({ kind: 'date', date: '2026-11-01' })
    expect(parseDoneSince('{"kind":"all_time"}')).toEqual({ kind: 'all_time' })
  })
})

describe('formatDoneSinceLabelKey', () => {
  it('names the i18n key for each period', () => {
    expect(formatDoneSinceLabelKey({ kind: 'today' })).toBe('time.today')
    expect(formatDoneSinceLabelKey({ kind: 'this_week' })).toBe('time.thisWeek')
    expect(formatDoneSinceLabelKey({ kind: 'this_month' })).toBe('time.thisMonth')
    expect(formatDoneSinceLabelKey({ kind: 'this_year' })).toBe('board.doneSince.thisYear')
    expect(formatDoneSinceLabelKey({ kind: 'all_time' })).toBe('board.doneSince.allTime')
    expect(formatDoneSinceLabelKey({ kind: 'date', date: '2026-11-01' })).toBe('board.doneSince.sinceDate')
  })
})
