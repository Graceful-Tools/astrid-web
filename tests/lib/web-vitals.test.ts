/**
 * The Core Web Vitals rules (AWTD-904).
 *
 * The aggregation is the part with a wrong answer that looks right: an empty
 * sample set must report "not measured", never a passing zero. That is the
 * exact confusion this task exists to fix in PERFORMANCE_BUDGETS.md, so it is
 * tested first.
 */

import { describe, it, expect } from 'vitest'
import {
  percentile,
  rateWebVital,
  summarizeWebVitals,
  normalizeVitalsRoute,
  isPlausibleSample,
  formatWebVital,
  WEB_VITAL_THRESHOLDS,
} from '@/lib/web-vitals'

describe('percentile (AWTD-904)', () => {
  it('returns null for an empty set rather than 0', () => {
    expect(percentile([], 75)).toBeNull()
  })

  it('takes the nearest rank, matching how CrUX reports p75', () => {
    // 4 samples: ceil(0.75 * 4) = 3rd smallest = 30.
    expect(percentile([10, 20, 30, 40], 75)).toBe(30)
  })

  it('does not care about input order', () => {
    expect(percentile([40, 10, 30, 20], 75)).toBe(30)
  })

  it('handles a single sample', () => {
    expect(percentile([7], 75)).toBe(7)
  })
})

describe('rateWebVital (AWTD-904)', () => {
  it('uses Google thresholds at the boundary inclusively', () => {
    expect(rateWebVital('LCP', 2500)).toBe('good')
    expect(rateWebVital('LCP', 2501)).toBe('needs-improvement')
    expect(rateWebVital('LCP', 4001)).toBe('poor')
  })

  it('rates CLS on its ratio scale, not milliseconds', () => {
    expect(rateWebVital('CLS', 0.1)).toBe('good')
    expect(rateWebVital('CLS', 0.3)).toBe('poor')
  })
})

describe('summarizeWebVitals (AWTD-904)', () => {
  it('reports no samples as "not measured", never as a passing zero', () => {
    const [lcp] = summarizeWebVitals([])

    expect(lcp.samples).toBe(0)
    expect(lcp.p75).toBeNull()
    expect(lcp.rating).toBeNull()
    // The bug this guards: a null p75 must NOT read as within budget.
    expect(lcp.withinBudget).toBeNull()
    expect(formatWebVital('LCP', lcp.p75)).toBe('not yet recorded')
  })

  it('computes p75 per metric and compares it to that metric threshold', () => {
    const rows = [
      { metric: 'LCP', value: 1000, authState: 'anonymous' },
      { metric: 'LCP', value: 2000, authState: 'anonymous' },
      { metric: 'LCP', value: 3000, authState: 'signed-in' },
      { metric: 'LCP', value: 9000, authState: 'signed-in' },
    ]
    const [lcp] = summarizeWebVitals(rows)

    expect(lcp.samples).toBe(4)
    expect(lcp.p75).toBe(3000)
    expect(lcp.withinBudget).toBe(false)
    expect(lcp.threshold).toBe(WEB_VITAL_THRESHOLDS.LCP.good)
  })

  it('breaks the p75 down by auth state, which is the acceptance criterion', () => {
    const rows = [
      { metric: 'INP', value: 100, authState: 'anonymous' },
      { metric: 'INP', value: 150, authState: 'anonymous' },
      { metric: 'INP', value: 400, authState: 'signed-in' },
    ]
    const [, inp] = summarizeWebVitals(rows)

    expect(inp.byAuthState.anonymous.samples).toBe(2)
    expect(inp.byAuthState.anonymous.p75).toBe(150)
    expect(inp.byAuthState['signed-in'].samples).toBe(1)
    expect(inp.byAuthState['signed-in'].p75).toBe(400)
  })

  it('keeps an unobserved auth state distinguishable from a fast one', () => {
    const [, , cls] = summarizeWebVitals([{ metric: 'CLS', value: 0.05, authState: 'anonymous' }])

    expect(cls.byAuthState['signed-in'].samples).toBe(0)
    expect(cls.byAuthState['signed-in'].p75).toBeNull()
  })

  it('always returns all three metrics, so a missing one is visible', () => {
    expect(summarizeWebVitals([]).map(s => s.metric)).toEqual(['LCP', 'INP', 'CLS'])
  })
})

describe('normalizeVitalsRoute (AWTD-904)', () => {
  it('collapses id segments so a route is one row', () => {
    expect(normalizeVitalsRoute('/en/lists/1f8c4a6e-2b3d-4c5e-9a7b-0d1e2f3a4b5c')).toBe('/lists/:id')
  })

  it('strips the locale prefix — same page, same budget', () => {
    expect(normalizeVitalsRoute('/fr/settings')).toBe('/settings')
    expect(normalizeVitalsRoute('/en/settings')).toBe('/settings')
  })

  it('does not mistake a real first segment for a locale', () => {
    expect(normalizeVitalsRoute('/settings/profile')).toBe('/settings/profile')
  })

  it('keeps the root path addressable', () => {
    expect(normalizeVitalsRoute('/en')).toBe('/en')
    expect(normalizeVitalsRoute('/')).toBe('/')
  })

  it('never stores an invite bearer token in the route (AWTD-984)', () => {
    // Invite tokens are `inv_` + 32 hex chars and redeem an invitation.
    // The beacon endpoint is unauthenticated by design, so the route column
    // must not carry a credential verbatim.
    expect(
      normalizeVitalsRoute('/en/invite/inv_9f2c4a6e8b1d3f5a7c9e2b4d6f8a1c3e'),
    ).toBe('/invite/:id')
  })

  it('never stores a share shortcode in the route (AWTD-984)', () => {
    // Shortcodes are bearer links to shared tasks/lists.
    expect(normalizeVitalsRoute('/s/Ab3xYz9Q')).toBe('/s/:id')
    expect(normalizeVitalsRoute('/en/s/Ab3xYz9Q')).toBe('/s/:id')
  })

  it('does not mistake an 8-char route word for a shortcode (AWTD-984)', () => {
    // "settings" is 8 alphanumeric chars but a real page, not a credential.
    expect(normalizeVitalsRoute('/en/settings')).toBe('/settings')
  })
})

describe('isPlausibleSample (AWTD-904)', () => {
  it('rejects the values a forged beacon would use to skew a p75', () => {
    expect(isPlausibleSample('LCP', Number.MAX_VALUE)).toBe(false)
    expect(isPlausibleSample('LCP', Infinity)).toBe(false)
    expect(isPlausibleSample('LCP', NaN)).toBe(false)
    expect(isPlausibleSample('LCP', -1)).toBe(false)
  })

  it('accepts ordinary readings, including a zero CLS', () => {
    expect(isPlausibleSample('CLS', 0)).toBe(true)
    expect(isPlausibleSample('LCP', 2400)).toBe(true)
  })
})
