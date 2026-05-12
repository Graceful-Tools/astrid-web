import { describe, expect, it } from 'vitest'
import {
  RECENTLY_COMPLETED_PRESETS,
  findPresetForWindow,
  presetForValue,
} from '@/lib/recently-completed-presets'

describe('recently-completed presets', () => {
  it('exposes labeled presets in stable order, defaulting first', () => {
    const ids = RECENTLY_COMPLETED_PRESETS.map(p => p.id)
    expect(ids[0]).toBe('default-24h')
    expect(ids).toContain('last-7-days')
    expect(ids).toContain('last-14-days')
    expect(ids).toContain('last-28-days')
    expect(ids).toContain('last-30-days')
    expect(ids).toContain('since-last-sunday')
    expect(ids).toContain('since-last-monday')
    expect(ids).toContain('since-first-of-month')
    expect(ids).toContain('since-specific-date')
  })

  it('every preset has a human-readable label', () => {
    for (const p of RECENTLY_COMPLETED_PRESETS) {
      expect(p.label.length).toBeGreaterThan(2)
    }
  })

  it('findPresetForWindow(null) returns the default 24h preset', () => {
    expect(findPresetForWindow(null)?.id).toBe('default-24h')
  })

  it('findPresetForWindow matches duration windows to the right preset', () => {
    expect(findPresetForWindow({ kind: 'duration', amount: 7, unit: 'day' })?.id).toBe('last-7-days')
    expect(findPresetForWindow({ kind: 'duration', amount: 14, unit: 'day' })?.id).toBe('last-14-days')
    expect(findPresetForWindow({ kind: 'duration', amount: 28, unit: 'day' })?.id).toBe('last-28-days')
    expect(findPresetForWindow({ kind: 'duration', amount: 30, unit: 'day' })?.id).toBe('last-30-days')
  })

  it('findPresetForWindow matches weekday + day-of-month + specific-date windows', () => {
    expect(findPresetForWindow({ kind: 'since-weekday', weekday: 0 })?.id).toBe('since-last-sunday')
    expect(findPresetForWindow({ kind: 'since-weekday', weekday: 1 })?.id).toBe('since-last-monday')
    expect(findPresetForWindow({ kind: 'since-day-of-month', day: 1 })?.id).toBe('since-first-of-month')
    expect(findPresetForWindow({ kind: 'since-date', date: '2026-04-01' })?.id).toBe('since-specific-date')
  })

  it('presetForValue is the inverse: id → window (default returns null = legacy 24h)', () => {
    expect(presetForValue('default-24h')).toBeNull()
    expect(presetForValue('last-7-days')).toEqual({ kind: 'duration', amount: 7, unit: 'day' })
    expect(presetForValue('since-last-monday')).toEqual({ kind: 'since-weekday', weekday: 1 })
    expect(presetForValue('since-first-of-month')).toEqual({ kind: 'since-day-of-month', day: 1 })
  })

  it("presetForValue('since-specific-date') returns null so the caller can prompt for the date", () => {
    // The picker UI handles the date prompt and constructs the window itself.
    expect(presetForValue('since-specific-date')).toBeNull()
  })
})
