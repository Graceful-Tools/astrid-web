/**
 * The Android app needs somewhere to land in analytics (AATD-2).
 *
 * The same gap Windows closed in f068b094, and the same failure if it is missed: the client
 * identifies itself correctly and every request still falls to UNKNOWN.
 *
 * astrid-android sends `x-platform: android-app` on every Astrid-bound request (through
 * astrid-core's `api::Platform::Android`). Header only: the app's user agent is the core's HTTP
 * stack, nothing Astrid about it — and it must never be confused with WEB_ANDROID, which is a
 * BROWSER on an Android phone and stays the web bucket.
 */

import { describe, it, expect } from 'vitest'
import {
  AnalyticsPlatform,
  ANALYTICS_PLATFORM_ORDER,
  detectPlatform,
} from '@/lib/analytics-events'

function req(headers: Record<string, string>) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as never
}

const CHROME_ON_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

describe('Android app analytics platform (AATD-2)', () => {
  it('has an Android app member whose value matches the wire string the client sends', () => {
    expect(AnalyticsPlatform.ANDROID_APP).toBe('android-app')
  })

  it('maps x-platform: android-app to the Android app', () => {
    expect(detectPlatform(req({ 'x-platform': 'android-app' }))).toBe(AnalyticsPlatform.ANDROID_APP)
  })

  it('prefers the header over an Android user agent', () => {
    expect(
      detectPlatform(req({ 'x-platform': 'android-app', 'user-agent': CHROME_ON_ANDROID })),
    ).toBe(AnalyticsPlatform.ANDROID_APP)
  })

  it('still reads Chrome on Android as the mobile web', () => {
    expect(detectPlatform(req({ 'user-agent': CHROME_ON_ANDROID }))).toBe(AnalyticsPlatform.WEB_ANDROID)
  })

  it('gives the Android app a column beside the other native apps', () => {
    const windows = ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.WINDOWS_APP)
    expect(ANALYTICS_PLATFORM_ORDER.indexOf(AnalyticsPlatform.ANDROID_APP)).toBe(windows + 1)
  })
})
