import { describe, expect, it } from 'vitest'
import { featureRefreshPolicy } from '@/lib/feature-flag-lifecycle'

describe('feature flag lifecycle', () => {
  it('ADEV-73: fetches on the first launch when this account has no cached flags', () => {
    // A new login has no cache, so skipping the fetch left project_mode off and
    // the sidebar without its Projects section until a second launch.
    expect(featureRefreshPolicy({ launchCount: 0, cacheUpdatedAt: null, now: 1000 })).toEqual({
      shouldFetch: true,
      nextLaunchCount: 1,
    })
  })

  it('does not fetch on the first launch when flags are already cached', () => {
    expect(featureRefreshPolicy({ launchCount: 0, cacheUpdatedAt: 900, now: 1000 }).shouldFetch).toBe(false)
  })

  it('refreshes after render on the second launch when uncached', () => {
    expect(featureRefreshPolicy({ launchCount: 1, cacheUpdatedAt: null, now: 1000 }).shouldFetch).toBe(true)
  })

  it('does not refresh a fresh cache', () => {
    expect(featureRefreshPolicy({ launchCount: 2, cacheUpdatedAt: 900, now: 1000, ttlMs: 200 }).shouldFetch).toBe(false)
  })
})
