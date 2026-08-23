import { BRAND } from '@/lib/brand/config'
import type { NextRequest } from 'next/server'

export const AnalyticsPlatform = {
  WEB_DESKTOP: 'web-desktop',
  WEB_IPHONE: 'web-iPhone',
  WEB_ANDROID: 'web-android',
  IOS_APP: 'iOS-app',
  /**
   * The Mac app. Value matches the `x-platform: mac-app` header the client has
   * sent since iOS/Mac build 232 — a mismatch here would look like the feature
   * working while every Mac request still fell to UNKNOWN. (Task b4591534.)
   */
  MAC_APP: 'mac-app',
  API_OTHER: 'API-other',
  UNKNOWN: 'unknown',
} as const

export type AnalyticsPlatformValue =
  (typeof AnalyticsPlatform)[keyof typeof AnalyticsPlatform]

/**
 * Detect the platform from a request's headers.
 */
export function detectPlatform(request: NextRequest): AnalyticsPlatformValue {
  // Defensive check for missing headers (can happen in test environments)
  if (!request?.headers?.get) {
    return AnalyticsPlatform.UNKNOWN
  }

  const userAgent = request.headers.get('user-agent') || ''
  const xPlatform = request.headers.get('x-platform')
  const authorization = request.headers.get('authorization') || ''

  // Mac native app. Header only, and deliberately so: the Mac agent is not
  // distinguishable from Safari by substring, which is exactly the trap the
  // iOS user-agent branch below fell into. (Task b4591534.)
  if (xPlatform === 'mac-app') {
    return AnalyticsPlatform.MAC_APP
  }

  // iOS native app - custom header first, then user agent.
  //
  // THE USER-AGENT BRANCH LIKELY NEVER FIRES. URLSession's default agent for
  // this bundle looks like 'Astrid App/231 CFNetwork/... Darwin/...' — a SPACE
  // where both candidates expect a slash, so neither substring is present. It
  // is left in place because it costs nothing and would match a client that
  // does send the slash form; the header is what actually identifies the app.
  // Widening it to the space form should be done against a captured header
  // rather than a guess — see tests/lib/analytics-mac-platform.ts.
  if (
    xPlatform === 'ios-app' ||
    userAgent.includes('AstridApp/') ||
    userAgent.includes(`${BRAND.appName}/`)
  ) {
    return AnalyticsPlatform.IOS_APP
  }

  // API calls via OAuth token (not web requests)
  // OAuth tokens start with 'astrid_' and typically come from programmatic access
  if (
    authorization.startsWith('******') &&
    !userAgent.includes('Mozilla') &&
    !userAgent.includes('Safari')
  ) {
    return AnalyticsPlatform.API_OTHER
  }

  // Mobile web - iPhone/iPod
  if (/iPhone|iPod/.test(userAgent)) {
    return AnalyticsPlatform.WEB_IPHONE
  }

  // Mobile web - Android
  if (/Android/.test(userAgent)) {
    return AnalyticsPlatform.WEB_ANDROID
  }

  // Desktop browsers (anything with Mozilla/Safari/Chrome that's not mobile)
  if (
    userAgent.includes('Mozilla') ||
    userAgent.includes('Chrome') ||
    userAgent.includes('Safari') ||
    userAgent.includes('Firefox') ||
    userAgent.includes('Edge')
  ) {
    return AnalyticsPlatform.WEB_DESKTOP
  }

  // Unknown - fallback for unusual user agents
  return AnalyticsPlatform.UNKNOWN
}
