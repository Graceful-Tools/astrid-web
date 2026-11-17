import { describe, expect, it } from 'vitest'
import { featureRefreshPolicy } from '@/lib/feature-flag-lifecycle'

describe('feature flag lifecycle', () => {
  it('does not fetch on the first-ever launch when flags are already cached', () => {
    expect(featureRefreshPolicy({ launchCount: 0, cacheUpdatedAt: 900, now: 1000 })).toEqual({
      shouldFetch: false,
      nextLaunchCount: 1,
    })
  })

  // ADEV-73: a new login on a fresh device has no cache; skipping the fetch left
  // project_mode false, so the sidebar drew no projects until a later launch.
  it('fetches on the first-ever launch when nothing is cached (ADEV-73)', () => {
    expect(featureRefreshPolicy({ launchCount: 0, cacheUpdatedAt: null, now: 1000 })).toEqual({
      shouldFetch: true,
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
