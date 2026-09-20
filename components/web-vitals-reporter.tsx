'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useRef } from 'react'
import { isWebVitalMetric, isPlausibleSample, type AuthState } from '@/lib/web-vitals'

/**
 * Client reporter for Core Web Vitals (AWTD-904).
 *
 * Uses Next's own `useReportWebVitals` rather than adding the `web-vitals`
 * package the task originally specified. Next already bundles that library to
 * implement this hook, so depending on it directly would ship the measurement
 * code twice and leave us a second copy to keep aligned with the framework's.
 * Same metrics, same source, one dependency fewer.
 *
 * Sends only what a percentile needs: the metric name, the number, the page
 * path, whether the visit was signed in, and an opaque per-tab id. No user id,
 * no session cookie, no query string. The path is normalised server-side.
 *
 * ## Why the samples are buffered
 *
 * `authState` is the whole point of the acceptance criterion — vitals have to
 * be observable for anonymous AND signed-in sessions — and `useSession()`
 * starts at `loading`. LCP is reported early, usually before that resolves, so
 * sending immediately would stamp `anonymous` on a large share of signed-in
 * page loads and make the breakdown quietly wrong in one direction. Samples
 * taken while the status is unresolved are held and flushed once it settles.
 */

const BEACON_PATH = '/api/internal/web-vitals'

interface PendingSample {
  metric: string
  value: number
  path: string
  sessionId: string
}

function send(sample: PendingSample, authState: AuthState) {
  const body = JSON.stringify({ ...sample, authState })

  // sendBeacon survives the page unload that LCP and CLS are usually reported
  // during; fetch with keepalive is the fallback where it is missing. Either
  // way this is fire-and-forget — a failed beacon must never reach the visitor.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(BEACON_PATH, new Blob([body], { type: 'application/json' }))
    return
  }

  void fetch(BEACON_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

export function WebVitalsReporter() {
  const pathname = usePathname()
  const { status } = useSession()
  const pending = useRef<PendingSample[]>([])
  const sessionIdRef = useRef<string>('')

  if (sessionIdRef.current === '') {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  const sessionId = sessionIdRef.current

  const authState: AuthState | null =
    status === 'loading' ? null : status === 'authenticated' ? 'signed-in' : 'anonymous'

  // Flush anything measured before the session status was known.
  useEffect(() => {
    if (authState === null || pending.current.length === 0) return
    const queued = pending.current
    pending.current = []
    for (const sample of queued) send(sample, authState)
  }, [authState])

  const report = useCallback(
    (metric: { name: string; value: number }) => {
      // The hook also emits FCP and TTFB; the budget tracks the three Core Web
      // Vitals, so anything else is dropped rather than stored unused.
      if (!isWebVitalMetric(metric.name)) return
      if (!isPlausibleSample(metric.name, metric.value)) return

      const sample: PendingSample = {
        metric: metric.name,
        value: metric.value,
        // usePathname is nullable outside an app-router render; the beacon
        // still wants a route, and '/' is the honest fallback.
        path: pathname ?? '/',
        sessionId,
      }

      if (authState === null) {
        pending.current.push(sample)
        return
      }
      send(sample, authState)
    },
    [pathname, authState, sessionId],
  )

  useReportWebVitals(report)

  return null
}
