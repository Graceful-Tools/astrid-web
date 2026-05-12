import type { RecentlyCompletedWindow } from '@/lib/recently-completed-window'

/**
 * Labeled presets surfaced in the list's Advanced Settings "Recently
 * completed window" dropdown. Decoupled from the helper itself so the UI can
 * grow without touching the filter logic.
 */
export type RecentlyCompletedPresetId =
  | 'default-24h'
  | 'last-7-days'
  | 'last-14-days'
  | 'last-28-days'
  | 'last-30-days'
  | 'since-last-sunday'
  | 'since-last-monday'
  | 'since-first-of-month'
  | 'since-specific-date'

export interface RecentlyCompletedPreset {
  id: RecentlyCompletedPresetId
  label: string
  /** null = legacy 24h default. The 'since-specific-date' preset also stores
   *  null here because the date is collected via a separate picker. */
  window: RecentlyCompletedWindow | null
}

export const RECENTLY_COMPLETED_PRESETS: ReadonlyArray<RecentlyCompletedPreset> = [
  { id: 'default-24h',          label: 'Last 24 hours (default)',          window: null },
  { id: 'last-7-days',          label: 'Last 7 days',                       window: { kind: 'duration', amount: 7, unit: 'day' } },
  { id: 'last-14-days',         label: 'Last 14 days',                      window: { kind: 'duration', amount: 14, unit: 'day' } },
  { id: 'last-28-days',         label: 'Last 28 days',                      window: { kind: 'duration', amount: 28, unit: 'day' } },
  { id: 'last-30-days',         label: 'Last 30 days',                      window: { kind: 'duration', amount: 30, unit: 'day' } },
  { id: 'since-last-sunday',    label: 'Since last Sunday (this week)',     window: { kind: 'since-weekday', weekday: 0 } },
  { id: 'since-last-monday',    label: 'Since last Monday (this week)',     window: { kind: 'since-weekday', weekday: 1 } },
  { id: 'since-first-of-month', label: 'Since the 1st of the month',        window: { kind: 'since-day-of-month', day: 1 } },
  { id: 'since-specific-date',  label: 'Since a specific date…',            window: null },
]

/**
 * Find the preset that matches a stored window. Returns the default preset
 * when window is null. Returns the 'since-specific-date' preset for any
 * since-date window (the date itself is shown separately).
 */
export function findPresetForWindow(
  window: RecentlyCompletedWindow | null | undefined,
): RecentlyCompletedPreset | undefined {
  if (window == null) {
    return RECENTLY_COMPLETED_PRESETS.find(p => p.id === 'default-24h')
  }
  if (window.kind === 'since-date') {
    return RECENTLY_COMPLETED_PRESETS.find(p => p.id === 'since-specific-date')
  }
  return RECENTLY_COMPLETED_PRESETS.find(p => {
    if (p.window == null) return false
    if (p.window.kind !== window.kind) return false
    if (p.window.kind === 'duration' && window.kind === 'duration') {
      return p.window.amount === window.amount && p.window.unit === window.unit
    }
    if (p.window.kind === 'since-weekday' && window.kind === 'since-weekday') {
      return p.window.weekday === window.weekday
    }
    if (p.window.kind === 'since-day-of-month' && window.kind === 'since-day-of-month') {
      return p.window.day === window.day
    }
    return false
  })
}

/**
 * Inverse mapping: preset id → window value to persist. For 'default-24h'
 * and 'since-specific-date' returns null (the caller stores legacy default
 * or prompts for a date and persists the constructed window itself).
 */
export function presetForValue(id: RecentlyCompletedPresetId): RecentlyCompletedWindow | null {
  if (id === 'default-24h' || id === 'since-specific-date') return null
  const found = RECENTLY_COMPLETED_PRESETS.find(p => p.id === id)
  return found?.window ?? null
}
