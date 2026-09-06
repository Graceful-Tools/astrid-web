/**
 * RED for task c2fbe8e4 — the security-sensitive routes all called the
 * SYNCHRONOUS, per-instance, in-memory limiter. "10 attempts per minute" was
 * really 10 x warm serverless instances, reset on every cold start. The sync
 * path must not exist at all, so it cannot be reached for again.
 *
 * Also guards the routes that had no limiter whatsoever: the four passkey
 * endpoints, the mobile session endpoint and the v1 signout endpoint.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import * as rateLimiter from '@/lib/rate-limiter'
import { RateLimiter } from '@/lib/rate-limiter'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('rate limiter has no synchronous path (task c2fbe8e4)', () => {
  it('does not expose a sync checkRateLimit', () => {
    expect((RateLimiter.prototype as Record<string, unknown>).checkRateLimit).toBeUndefined()
  })

  it('does not export the sync middleware helpers', () => {
    const exported = rateLimiter as unknown as Record<string, unknown>
    expect(exported.withRateLimit).toBeUndefined()
    expect(exported.withRateLimitHandler).toBeUndefined()
  })

  it('has no remaining sync call sites under app/, lib/ or mcp/', () => {
    const offenders: string[] = []
    for (const root of ['app', 'lib', 'mcp']) {
      for (const file of walk(join(ROOT, root))) {
        const src = readFileSync(file, 'utf8')
        // Deliberately matches the sync names only: the async variants all end in "Async(".
        if (/\bwithRateLimit\(|\bwithRateLimitHandler\(|\.checkRateLimit\(/.test(src)) {
          offenders.push(file.replace(`${ROOT}/`, ''))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('previously unlimited auth routes carry a limiter (task c2fbe8e4)', () => {
  const routes = [
    'app/api/auth/webauthn/register/options/route.ts',
    'app/api/auth/webauthn/register/verify/route.ts',
    'app/api/auth/webauthn/authenticate/options/route.ts',
    'app/api/auth/webauthn/authenticate/verify/route.ts',
    'app/api/auth/mobile-session/route.ts',
    'app/api/v1/auth/signout/route.ts',
  ]

  it.each(routes)('%s applies a rate limiter', (route) => {
    const src = readFileSync(join(ROOT, route), 'utf8')
    expect(src).toMatch(/RateLimit/)
  })
})
