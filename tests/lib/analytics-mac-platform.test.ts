/**
 * The Mac app needs somewhere to land in analytics (task b4591534).
 *
 * The client half already shipped in iOS/Mac build 232: every request from all
 * three AstridAPIClient builders and the legacy APIClient carries
 *
 *     x-platform: ios-app     (iOS)
 *     x-platform: mac-app     (Mac)
 *
 * and detectPlatform reads x-platform BEFORE any user-agent sniffing. So
 * `ios-app` is already honoured. `mac-app` had nowhere to go: there was no Mac
 * member of AnalyticsPlatform, so a correctly-identifying Mac fell through to
 * UNKNOWN.
 *
 * THE USER-AGENT MATCH, and why it is worth a test rather than a fix.
 * detectPlatform also tries:
 *
 *     userAgent.includes('AstridApp/') || userAgent.includes(`${BRAND.appName}/`)
 *
 * BRAND.appName is 'Astrid', so the second is 'Astrid/'. URLSession's default
 * agent for this bundle is of the form 'Astrid App/231 CFNetwork/... Darwin/...'
 * — a SPACE where both candidates expect a slash. Neither substring is present.
 *
 * The task flagged that as unconfirmed against a real device, and it still is;
 * these cases pin the LOGIC rather than claim what iOS actually sends. If the
 * agent really is 'Astrid App/', historical iOS traffic has been landing in
 * UNKNOWN — which changes how every past week reads. The header path makes that
 * moot going forward, and the test below records the gap so the next reader does
 * not assume the user-agent branch works.
 */

import { describe, it, expect } from 'vitest'
import {
  AnalyticsPlatform,
  ANALYTICS_PLATFORM_ORDER,
  detectPlatform,
} from '@/lib/analytics-events'

/** A request carrying only the headers under test. */
function req(headers: Record<string, string>) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as never
}

describe('Mac app analytics platform (task b4591534)', () => {
  it('has a Mac member whose value matches the wire string the client sends', () => {
    // The client sends `x-platform: mac-app`; a mismatch here would look like
    // the feature working while every Mac request still fell to UNKNOWN.
    expect(AnalyticsPlatform.MAC_APP).toBe('mac-app')
  })

  it('maps x-platform: mac-app to the Mac platform', () => {
    expect(detectPlatform(req({ 'x-platform': 'mac-app' }))).toBe(AnalyticsPlatform.MAC_APP)
  })

  it('still maps x-platform: ios-app to the iOS platform', () => {
    expect(detectPlatform(req({ 'x-platform': 'ios-app' }))).toBe(AnalyticsPlatform.IOS_APP)
  })

  it('gives Mac a stable column in the admin table', () => {
    // Absent from the order array, the platform exists but never renders.
    expect(ANALYTICS_PLATFORM_ORDER).toContain(AnalyticsPlatform.MAC_APP)
  })

  it('keeps Mac next to iOS in the display order', () => {
    const ios = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.IOS_APP)
    const mac = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.MAC_APP)
    expect(mac).toBe(ios + 1)
  })
})

describe('the user-agent fallback, as it actually behaves (task b4591534)', () => {
  it('DOES NOT match the agent iOS is believed to send', () => {
    // 'Astrid App/231' — a space, not a slash. Recorded rather than fixed:
    // the header path already covers it, and widening the substring match is a
    // change that should be made against a captured header rather than a guess.
    const result = detectPlatform(req({ 'user-agent': 'Astrid App/231 CFNetwork/1500 Darwin/24.0.0' }))
    expect(result).not.toBe(AnalyticsPlatform.IOS_APP)
  })

  it('does match the slash form the code was written for', () => {
    expect(detectPlatform(req({ 'user-agent': 'AstridApp/231 CFNetwork/1500' }))).toBe(
      AnalyticsPlatform.IOS_APP,
    )
  })

  it('prefers the header over any user agent', () => {
    // The header is authoritative: a Mac request must not be read as iOS
    // because of whatever URLSession put in the agent.
    expect(
      detectPlatform(req({ 'x-platform': 'mac-app', 'user-agent': 'AstridApp/231' })),
    ).toBe(AnalyticsPlatform.MAC_APP)
  })
})
