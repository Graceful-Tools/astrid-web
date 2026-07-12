import { describe, expect, it } from 'vitest'
import { evaluateFeatureFlag, stableRolloutBucket } from '@/lib/feature-flags'

const base = {
  key: 'google_tasks',
  enabled: true,
  rolloutMode: 'SELECTED_USERS' as const,
  rolloutPercentage: 0,
  targets: [] as Array<{ userId: string; treatment: 'INCLUDE' | 'EXCLUDE' }>,
}

describe('feature flag evaluation', () => {
  it('fails closed for a missing or disabled flag', () => {
    expect(evaluateFeatureFlag(null, 'user-1')).toBe(false)
    expect(evaluateFeatureFlag({ ...base, enabled: false }, 'user-1')).toBe(false)
  })

  it('gives explicit exclusions precedence over global rollout', () => {
    expect(evaluateFeatureFlag({
      ...base,
      rolloutMode: 'ALL',
      targets: [{ userId: 'user-1', treatment: 'EXCLUDE' }],
    }, 'user-1')).toBe(false)
  })

  it('gives explicit inclusions precedence over selected-user mode', () => {
    expect(evaluateFeatureFlag({
      ...base,
      targets: [{ userId: 'user-1', treatment: 'INCLUDE' }],
    }, 'user-1')).toBe(true)
  })

  it('uses stable deterministic percentage buckets', () => {
    const first = stableRolloutBucket('google_tasks', 'user-1')
    expect(first).toBe(stableRolloutBucket('google_tasks', 'user-1'))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(100)
    expect(evaluateFeatureFlag({ ...base, rolloutMode: 'PERCENTAGE', rolloutPercentage: 100 }, 'user-1')).toBe(true)
    expect(evaluateFeatureFlag({ ...base, rolloutMode: 'PERCENTAGE', rolloutPercentage: 0 }, 'user-1')).toBe(false)
  })
})
