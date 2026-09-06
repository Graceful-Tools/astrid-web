/**
 * Content Security Policy, built per request around a nonce (task eea00b1b).
 *
 * The policy used to live in next.config.mjs and carry `'unsafe-inline'` in
 * script-src, which defeats the point: CSP's job is to stop injected script
 * from executing, and `'unsafe-inline'` permits exactly that. It also allowed
 * https://unpkg.com — the whole of npm — because public/sw.js pulled Dexie
 * from there. Dexie is vendored now, and static headers cannot carry a
 * per-request nonce, so the policy is assembled here and applied in
 * middleware.ts where a nonce exists.
 *
 * `'strict-dynamic'` is what makes this workable with Next: the nonce is
 * applied to Next's own bootstrap scripts, and those are then trusted to load
 * the chunk graph without every chunk URL being listed. Under strict-dynamic a
 * browser that supports it IGNORES the host allow-list for scripts, so the
 * hosts below are there for older browsers only.
 */

const SCRIPT_HOSTS = [
  'https://va.vercel-scripts.com',
  'https://vercel.live',
  'https://static.cloudflareinsights.com',
]

const IMG_HOSTS = [
  'https://lh3.googleusercontent.com',
  'https://images.unsplash.com',
  'https://*.vercel-storage.com',
  'https://*.public.blob.vercel-storage.com',
]

const CONNECT_HOSTS = [
  'https://vitals.vercel-insights.com',
  'https://*.vercel-insights.com',
  'https://vercel.live',
  'wss://ws-us3.pusher.com',
  'https://sockjs-us3.pusher.com',
  'https://oauth2.googleapis.com',
  'https://people.googleapis.com',
  'https://*.vercel-storage.com',
  'https://*.public.blob.vercel-storage.com',
  'https://lh3.googleusercontent.com',
]

const FRAME_HOSTS = [
  'https://accounts.google.com',
  'https://appleid.apple.com',
  'https://vercel.live',
]

/**
 * Build the policy for one request.
 *
 * @param nonce base64 nonce, fresh per request — reusing one across requests
 *   would make it guessable and therefore useless.
 * @param isProduction dev needs 'unsafe-eval' for React Refresh, and
 *   upgrade-insecure-requests breaks Safari on localhost.
 */
export function buildContentSecurityPolicy(nonce: string, isProduction: boolean): string {
  const directives = [
    `default-src 'self'`,
    // No 'unsafe-inline'. The nonce covers Next's own scripts; strict-dynamic
    // lets those load the rest of the chunk graph.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isProduction ? '' : `'unsafe-eval'`} ${SCRIPT_HOSTS.join(' ')}`,
    `worker-src 'self' blob:`,
    // style-src KEEPS 'unsafe-inline'. Tailwind and every React inline `style`
    // prop produce inline styles, and a style nonce cannot reach a style
    // attribute at all. Inline style is a far weaker primitive than inline
    // script, and this task's acceptance is about scripts.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob: ${IMG_HOSTS.join(' ')}`,
    `connect-src 'self' ${CONNECT_HOSTS.join(' ')}`,
    `frame-src 'self' ${FRAME_HOSTS.join(' ')}`,
    `frame-ancestors 'self'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ]

  return directives.join('; ').replace(/\s{2,}/g, ' ').trim()
}

/** A fresh base64 nonce. Uses Web Crypto, so it works in the edge runtime. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
