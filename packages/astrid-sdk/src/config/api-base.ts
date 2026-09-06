/**
 * One place that decides which server the SDK talks to.
 *
 * There used to be three answers: `channel/rest-client.ts`,
 * `channel/sse-client.ts` and `channel/oauth-client.ts` defaulted to
 * `https://www.astrid.cc/api/v1`, while `adapters/astrid-oauth.ts` defaulted to
 * `https://astrid.cc`. Those disagree about the HOST, not just the brand, so
 * the SDK could hold a session on one origin and call the API on another —
 * wrong on Astrid, and doubly wrong for anyone pointing it at their own
 * deployment (task 979e1325).
 *
 * Resolution order, most specific first:
 *   1. an explicit value passed by the caller
 *   2. ASTRID_API_URL / ASTRID_API_BASE_URL in the environment
 *   3. the Astrid production origin
 */

const FALLBACK_ORIGIN = 'https://www.astrid.cc'

function envOrigin(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const configured = env?.ASTRID_API_URL || env?.ASTRID_API_BASE_URL
  return configured?.trim() || undefined
}

/** Strip a trailing slash so callers can concatenate a leading-slash path safely. */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/** Origin only, e.g. `https://www.astrid.cc`. */
export function resolveOrigin(explicit?: string): string {
  return normalize(explicit || envOrigin() || FALLBACK_ORIGIN)
}

/** Versioned API base, e.g. `https://www.astrid.cc/api/v1`. */
export function resolveApiBase(explicit?: string): string {
  if (explicit) return normalize(explicit)
  return `${resolveOrigin()}/api/v1`
}
