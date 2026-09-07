/**
 * The Windows app needs somewhere to land in analytics.
 *
 * Same shape as the Mac gap (task b4591534, tests/lib/analytics-mac-platform.test.ts) and the same
 * failure if it is missed: the client identifies itself correctly and every request still falls to
 * UNKNOWN, so the dashboard reads as though nobody is using the app.
 *
 * The Windows client sends `x-platform: windows-app` on every Astrid-bound request, and
 * detectPlatform reads x-platform before any user-agent sniffing. That header is the whole
 * identification: a WinUI app's user agent is a Windows HTTP stack string with nothing Astrid about
 * it, so there is no user-agent branch to add here and no reason to want one.
 *
 * This must be deployed before the Windows client ships, not alongside it — the server has to be
 * ready to receive a platform the moment a build starts sending it.
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

describe('Windows app analytics platform', () => {
  it('has a Windows member whose value matches the wire string the client sends', () => {
    // astrid-windows sends this exact string. A mismatch here is invisible: the feature looks
    // shipped and the traffic keeps landing in UNKNOWN.
    expect(AnalyticsPlatform.WINDOWS_APP).toBe('windows-app')
  })

  it('maps x-platform: windows-app to the Windows platform', () => {
    expect(detectPlatform(req({ 'x-platform': 'windows-app' }))).toBe(
      AnalyticsPlatform.WINDOWS_APP,
    )
  })

  it('leaves the other native platforms alone', () => {
    expect(detectPlatform(req({ 'x-platform': 'mac-app' }))).toBe(AnalyticsPlatform.MAC_APP)
    expect(detectPlatform(req({ 'x-platform': 'ios-app' }))).toBe(AnalyticsPlatform.IOS_APP)
  })

  it('gives Windows a stable column in the admin table', () => {
    // Absent from the order array, the platform exists but never renders.
    expect(ANALYTICS_PLATFORM_ORDER).toContain(AnalyticsPlatform.WINDOWS_APP)
  })

  it('keeps the native apps together in the display order', () => {
    const ios = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.IOS_APP)
    const mac = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.MAC_APP)
    const windows = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.WINDOWS_APP)
    expect(mac).toBe(ios + 1)
    expect(windows).toBe(mac + 1)
  })

  it('prefers the header over the user agent', () => {
    // A Windows request must not be read as desktop web because Edge's agent says Mozilla.
    expect(
      detectPlatform(
        req({
          'x-platform': 'windows-app',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        }),
      ),
    ).toBe(AnalyticsPlatform.WINDOWS_APP)
  })

  it('still reads a Windows browser as desktop web', () => {
    // Without the header this is just Edge on Windows, and must stay in the web bucket.
    expect(
      detectPlatform(
        req({
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120',
        }),
      ),
    ).toBe(AnalyticsPlatform.WEB_DESKTOP)
  })
})
