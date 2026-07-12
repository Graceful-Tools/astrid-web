export type RolloutMode = 'OFF' | 'ALL' | 'PERCENTAGE' | 'SELECTED_USERS'

export interface FeatureRolloutDraft {
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  includedEmails: string[]
  excludedEmails: string[]
  invalidEmails: string[]
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeOverrideEmails(value: string): { emails: string[]; invalid: string[] } {
  const unique = [...new Set(value.split(/[\s,]+/).map(item => item.trim().toLowerCase()).filter(Boolean))]
  return {
    emails: unique.filter(item => EMAIL.test(item)).sort(),
    invalid: unique.filter(item => !EMAIL.test(item)).sort(),
  }
}

export function buildFeatureRolloutDraft(input: {
  enabled: boolean
  rolloutMode: RolloutMode
  rolloutPercentage: number
  included: string
  excluded: string
}): FeatureRolloutDraft {
  const included = normalizeOverrideEmails(input.included)
  const excluded = normalizeOverrideEmails(input.excluded)
  const excludedSet = new Set(excluded.emails)
  return {
    enabled: input.enabled,
    rolloutMode: input.rolloutMode,
    rolloutPercentage: Math.max(0, Math.min(100, Math.round(input.rolloutPercentage))),
    includedEmails: included.emails.filter(email => !excludedSet.has(email)),
    excludedEmails: excluded.emails,
    invalidEmails: [...new Set([...included.invalid, ...excluded.invalid])].sort(),
  }
}

export function rolloutDraftChanged(saved: FeatureRolloutDraft | null, current: FeatureRolloutDraft): boolean {
  if (!saved) return false
  return JSON.stringify(saved) !== JSON.stringify(current)
}

export function describeEffectiveRollout(
  enabled: boolean,
  mode: RolloutMode,
  percentage: number,
  includedCount: number,
  excludedCount: number
): string {
  if (!enabled) return 'Off for everyone. Saved overrides are retained but inactive.'
  const except = excludedCount ? `, except ${excludedCount} explicitly excluded user${excludedCount === 1 ? '' : 's'}` : ''
  if (mode === 'ALL') return `On for all users${except}.`
  if (mode === 'PERCENTAGE') return `On for a stable ${percentage}% of users plus ${includedCount} explicitly included user${includedCount === 1 ? '' : 's'}${except}.`
  if (mode === 'SELECTED_USERS') return `On for ${includedCount} explicitly included user${includedCount === 1 ? '' : 's'}${except}.`
  return `Off by rollout mode${includedCount ? `, with ${includedCount} explicit inclusion${includedCount === 1 ? '' : 's'}` : ''}${except}.`
}
