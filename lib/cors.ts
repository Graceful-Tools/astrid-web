/**
 * CORS policy for the API, derived from the brand rather than hardcoded.
 *
 * This used to be a static header block in next.config.mjs:
 *
 *   Access-Control-Allow-Origin: https://astrid.cc
 *   Access-Control-Allow-Credentials: true
 *
 * Static headers cannot vary by request, so every deployment — including a
 * partner's — told browsers that Astrid's domain may make CREDENTIALED
 * cross-origin calls to it, and sent no `Vary: Origin`, so a shared cache could
 * hand one origin's grant to another (task 229c175c).
 *
 * Edge-safe by construction: string operations and `process.env` only. It is
 * imported by middleware.ts, which runs on the edge — see
 * tests/middleware-edge-safety.test.ts for what happens when that slips.
 */

import { BRAND } from './brand/config'

export const CORS_ALLOWED_HEADERS = [
  'X-CSRF-Token',
  'X-Requested-With',
  'Accept',
  'Accept-Version',
  'Content-Length',
  'Content-MD5',
  'Content-Type',
  'Date',
  'X-Api-Version',
  'Authorization',
  'X-OAuth-Token',
  'X-API-Version',
  'X-Internal-Secret',
  'X-Platform',
].join(', ')

export const CORS_ALLOWED_METHODS = 'GET,OPTIONS,PATCH,DELETE,POST,PUT'

/**
 * Origins allowed to make credentialed requests to this deployment: the brand's
 * apex and its www host, plus any extra origins the operator names in
 * `CORS_ALLOWED_ORIGINS` (comma-separated, scheme included).
 *
 * Localhost is allowed outside production so the dev server keeps working.
 */
export function allowedOrigins(): string[] {
  const origins = [`https://${BRAND.domain}`, `https://www.${BRAND.domain}`]

  const extra = process.env.CORS_ALLOWED_ORIGINS
  if (extra) {
    for (const origin of extra.split(',').map(o => o.trim()).filter(Boolean)) {
      origins.push(origin)
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000')
  }

  return origins
}

/**
 * The CORS headers for a request carrying `origin`.
 *
 * An origin that is not on the allow-list gets NO `Access-Control-Allow-Origin`
 * and no `Allow-Credentials` — the browser then refuses the cross-origin read,
 * which is the point. `Vary: Origin` is always sent, because the response
 * genuinely does depend on the Origin header.
 */
export function corsHeadersForOrigin(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS,
    'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
  }

  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  return headers
}
