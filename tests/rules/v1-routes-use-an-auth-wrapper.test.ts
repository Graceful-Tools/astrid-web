/**
 * Every v1 route authenticates through a WRAPPER, or is deliberately public
 * (task 17fea642).
 *
 * The finding this comes from read: "25 of 219 /api/v1 routes bypass withAuth
 * (including app/api/v1/agent/tasks/** and app/api/v1/chat/channels/route.ts)
 * and so must remember capabilityGate() by hand." Both named examples turn out
 * not to be that:
 *
 *   app/api/v1/chat/channels/route.ts   is nine lines, eight of them a comment,
 *                                       and one `export { POST } from '../..'`.
 *                                       It has no auth code because it has no
 *                                       code; the legacy handler it re-exports
 *                                       authenticates.
 *   app/api/v1/agent/tasks/route.ts     uses withAgentAuth — a sibling wrapper
 *                                       with the same shape as withAuth, for
 *                                       agent tokens rather than user sessions.
 *
 * Grepping for the string "withAuth" counts both as bypasses. That is how a
 * number like 25 gets produced, and it is why this file asserts the SHAPE
 * rather than a count: a v1 route either delegates to a wrapper, re-exports a
 * handler that does, or is listed below as public with a reason.
 *
 * WHAT IT WOULD ACTUALLY CATCH: a new v1 route that calls authenticateAPI or
 * getUnifiedSession inline. That route owns its own scope check and its own
 * capability gate, and the next person to add a capability will not know it
 * exists. There is one such route today — app/api/v1/agent/events — and it is
 * named below rather than quietly tolerated.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const V1 = join(ROOT, 'app/api/v1')

/** Wrappers that own authentication, scope checking and the capability gate. */
const AUTH_WRAPPERS = /\b(withAuth|withAgentAuth|withOpenClawAuth)\s*(?:<|\()/

/** `export { GET, POST } from '../../…'` — the delegate does the authenticating. */
const RE_EXPORT = /^export\s*\{[^}]*\}\s*from\s*['"]/m

/** Authentication done inline, which is the thing worth catching. */
const INLINE_AUTH = /\b(authenticateAPI|getUnifiedSession|getServerSession|authenticateAgentRequest)\s*\(/

/**
 * Routes with no authentication, on purpose. Each needs a reason, because
 * "this one is public" is exactly the sentence an accident also produces.
 */
const PUBLIC: Record<string, string> = {
  'app/api/v1/capabilities/route.ts':
    'describes the deployment, not a user; the client needs it BEFORE sign-in to know which sign-in methods to show',
  'app/api/v1/agent-icon/[slug]/route.ts': 'serves a static agent icon',
  'app/api/v1/oauth/token/route.ts': 'the token endpoint — it issues credentials, it cannot require them',
  'app/api/v1/oauth/register/route.ts': 'RFC 7591 dynamic client registration',
  'app/api/v1/auth/apple/route.ts': 'establishes a session; there is none yet',
  'app/api/v1/auth/google/route.ts': 'establishes a session; there is none yet',
  'app/api/v1/auth/mobile-session/route.ts': 'establishes a session; there is none yet',
  'app/api/v1/auth/mobile-mcp-token/route.ts': 'exchanges a sign-in for an MCP token',
  'app/api/v1/auth/desktop/exchange/route.ts': 'redeems a single-use desktop hand-off grant',
  'app/api/v1/auth/signout/route.ts': 'clears a session; safe to call without one',
  'app/api/v1/integrations/github/callback/route.ts': 'OAuth callback — the provider calls it, not a signed-in client',
  'app/api/v1/integrations/google/callback/route.ts': 'OAuth callback — the provider calls it, not a signed-in client',
  'app/api/v1/integrations/copilot/callback/route.ts': 'OAuth callback — the provider calls it, not a signed-in client',
  'app/api/v1/integrations/resume/route.ts':
    'where a signed-out OAuth callback finishes (task 842601f2): it checks the session itself so it can redirect a signed-out browser INTO sign-in, which is the whole point — a 401 from withAuth would strand it',
}

/**
 * Inline authentication that pre-dates the wrappers. Not blessed — listed, so
 * the number is one that someone chose rather than one nobody measured.
 */
const INLINE_AUTH_ALLOWED: Record<string, string> = {
  'app/api/v1/agent/events/route.ts':
    'SSE: the stream is constructed from the auth result and the rate limiter needs the clientId before the response begins, so the wrapper’s request/response shape does not fit as-is',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

describe('v1 routes authenticate through a wrapper (task 17fea642)', () => {
  const routes = walk(V1).map(f => ({ rel: relative(ROOT, f), source: readFileSync(f, 'utf8') }))

  it('finds the v1 surface at all', () => {
    expect(routes.length).toBeGreaterThan(100)
  })

  it('every route uses a wrapper, re-exports one, or is listed as public', () => {
    const unaccounted = routes
      .filter(r => !AUTH_WRAPPERS.test(r.source))
      .filter(r => !RE_EXPORT.test(r.source))
      .filter(r => !(r.rel in PUBLIC))
      .filter(r => !(r.rel in INLINE_AUTH_ALLOWED))
      .map(r => r.rel)

    expect(
      unaccounted,
      `A v1 route that neither uses withAuth/withAgentAuth nor re-exports a ` +
        `handler that does. Use a wrapper — it carries the scope check and the ` +
        `capability gate — or add the route to PUBLIC with a reason:\n  ` +
        unaccounted.join('\n  '),
    ).toEqual([])
  })

  it('no route both uses a wrapper and authenticates inline', () => {
    // Belt and braces is the shape that hides a bug: the wrapper's result and
    // the inline one can disagree about who the caller is.
    const both = routes
      .filter(r => AUTH_WRAPPERS.test(r.source) && INLINE_AUTH.test(r.source))
      .map(r => r.rel)
    expect(both).toEqual([])
  })

  it('the PUBLIC list has no stale entries', () => {
    const stale = Object.keys(PUBLIC).filter(rel => !routes.some(r => r.rel === rel))
    expect(stale, `PUBLIC names routes that no longer exist: ${stale.join(', ')}`).toEqual([])
  })
})
