/**
 * Sends a render error caught by an error boundary to the server (AWTD-1076).
 *
 * Tapping a task row on a phone showed "Something went wrong" and nothing
 * recorded why: the boundary logged only in development, and a client-side
 * crash makes no failing request for the server logs to catch. This is the one
 * path a production render error has to the logs.
 *
 * Client-safe on purpose — both boundaries import it, and global-error.tsx
 * replaces the root layout, so it cannot lean on any provider.
 */

export const CLIENT_ERROR_BEACON_PATH = '/api/internal/client-errors'

export const CLIENT_ERROR_BOUNDARIES = ['route', 'global'] as const
export type ClientErrorBoundary = (typeof CLIENT_ERROR_BOUNDARIES)[number]

/** Bounds shared with the route's schema, so a long stack is cut, not refused. */
export const CLIENT_ERROR_LIMITS = { message: 1000, stack: 4000, digest: 200, path: 2048 } as const

export function reportClientError(
  error: Error & { digest?: string },
  boundary: ClientErrorBoundary,
): void {
  try {
    const body = JSON.stringify({
      boundary,
      message: String(error?.message ?? error).slice(0, CLIENT_ERROR_LIMITS.message),
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, CLIENT_ERROR_LIMITS.stack) : undefined,
      digest: error?.digest?.slice(0, CLIENT_ERROR_LIMITS.digest),
      // No query string: `?task=<id>` identifies what was open.
      path: window.location.pathname.slice(0, CLIENT_ERROR_LIMITS.path),
    })

    // Same transport as the web-vitals beacon: sendBeacon survives the person
    // tapping "Go home" straight away; fetch with keepalive is the fallback.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(CLIENT_ERROR_BEACON_PATH, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(CLIENT_ERROR_BEACON_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting must never make the error page itself fail.
  }
}
