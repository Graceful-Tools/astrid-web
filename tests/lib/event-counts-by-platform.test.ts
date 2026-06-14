import { describe, it, expect } from 'vitest'
import {
  buildEventCountsByPlatform,
  ANALYTICS_PLATFORM_ORDER,
  ANALYTICS_EVENT_ORDER,
} from '@/lib/analytics-events'

describe('buildEventCountsByPlatform (task 4973120b — metrics by interface)', () => {
  it('zero-fills every known platform and event type', () => {
    const result = buildEventCountsByPlatform([])

    // Every known platform present...
    for (const platform of ANALYTICS_PLATFORM_ORDER) {
      expect(result.byPlatform[platform]).toBeDefined()
      // ...with every known event zero-filled.
      for (const eventType of ANALYTICS_EVENT_ORDER) {
        expect(result.byPlatform[platform][eventType]).toBe(0)
      }
      expect(result.totalsByPlatform[platform]).toBe(0)
    }
    for (const eventType of ANALYTICS_EVENT_ORDER) {
      expect(result.totalsByEvent[eventType]).toBe(0)
    }
  })

  it('aggregates counts per platform and event with correct totals', () => {
    const result = buildEventCountsByPlatform([
      { platform: 'web-desktop', eventType: 'task_created', count: 5 },
      { platform: 'web-desktop', eventType: 'task_completed', count: 2 },
      { platform: 'iOS-app', eventType: 'task_created', count: 3 },
      { platform: 'web-iPhone', eventType: 'comment_added', count: 4 },
    ])

    expect(result.byPlatform['web-desktop']['task_created']).toBe(5)
    expect(result.byPlatform['web-desktop']['task_completed']).toBe(2)
    expect(result.byPlatform['iOS-app']['task_created']).toBe(3)
    expect(result.byPlatform['web-iPhone']['comment_added']).toBe(4)

    // task_created total across web-desktop + iOS-app
    expect(result.totalsByEvent['task_created']).toBe(8)
    // web-desktop total across its two events
    expect(result.totalsByPlatform['web-desktop']).toBe(7)
    expect(result.totalsByPlatform['iOS-app']).toBe(3)
  })

  it('folds in unknown platforms/events rather than dropping them', () => {
    const result = buildEventCountsByPlatform([
      { platform: 'some-new-client', eventType: 'task_created', count: 9 },
      { platform: 'web-desktop', eventType: 'brand_new_event', count: 1 },
    ])

    expect(result.byPlatform['some-new-client']['task_created']).toBe(9)
    expect(result.totalsByPlatform['some-new-client']).toBe(9)
    expect(result.byPlatform['web-desktop']['brand_new_event']).toBe(1)
    expect(result.totalsByEvent['brand_new_event']).toBe(1)
  })
})
