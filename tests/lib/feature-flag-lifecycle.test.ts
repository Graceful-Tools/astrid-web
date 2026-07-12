import { describe, expect, it } from 'vitest'
import { featureRefreshPolicy } from '@/lib/feature-flag-lifecycle'

describe('feature flag lifecycle', () => {
  it('does not fetch on the first-ever launch', () => {
    expect(featureRefreshPolicy({ launchCount: 0, cacheUpdatedAt: null, now: 1000 })).toEqual({
      shouldFetch: false,
      nextLaunchCount: 1,
    })
  })

  it('refreshes after render on the second launch when uncached', () => {
    expect(featureRefreshPolicy({ launchCount: 1, cacheUpdatedAt: null, now: 1000 }).shouldFetch).toBe(true)
  })

  it('does not refresh a fresh cache', () => {
    expect(featureRefreshPolicy({ launchCount: 2, cacheUpdatedAt: 900, now: 1000, ttlMs: 200 }).shouldFetch).toBe(false)
  })
})
