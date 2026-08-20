/**
 * Cron routes must fail CLOSED (task 2f4babb1).
 *
 * All five gated on the secret only when the secret happened to be set:
 *
 *     if (process.env.CRON_SECRET && authHeader !== `Bearer ${...}`) return 401
 *
 * If CRON_SECRET is missing or misspelled in the environment, `&&`
 * short-circuits and every one of them becomes a public, unauthenticated GET.
 *
 * The new route is the dangerous one. `GET /api/cron/github-sync` runs every 15
 * minutes and calls syncAllGithubLinks(), which walks EVERY user's
 * ExternalListLink, fetches each owner's GitHub token, and both pushes to and
 * pulls from their repos. Unauthenticated, an anonymous caller could drive
 * all-tenant GitHub traffic in a loop.
 *
 * And the precondition is a recorded, recurring condition in this repo, not a
 * hypothetical: ASTRID.md's working agreements already warn that recurring 401s
 * have been traced to env vars missing AT DEPLOY TIME. CRON_SECRET is also
 * absent from .env.example, so a fresh environment starts without it. This
 * pattern turns that ordinary slip into an open door instead of a 401.
 *
 * The local-dev opt-out is deliberately explicit and cannot fire in production:
 * an unset secret is an outage for the cron jobs, and an operator should see
 * that immediately rather than discover a silent hole later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'

const ORIGINAL_ENV = { ...process.env }

function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://astrid.cc/api/cron/github-sync', { headers })
}

beforeEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.ALLOW_UNAUTHENTICATED_CRON
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('requireCronSecret', () => {
  it('401s an unauthenticated request when no secret is configured', () => {
    // The bug: today this path returns 200 and runs the job.
    const blocked = requireCronSecret(request())

    expect(blocked, 'no secret configured must mean nobody gets in').not.toBeNull()
    expect(blocked!.status).toBe(401)
  })

  it('401s even when the caller presents a plausible bearer token', () => {
    // With no configured secret there is nothing to match against, so every
    // token is equally wrong.
    const blocked = requireCronSecret(request({ authorization: 'Bearer anything-at-all' }))

    expect(blocked?.status).toBe(401)
  })

  it('lets the real scheduler through when the secret matches', () => {
    process.env.CRON_SECRET = 'the-real-secret'

    expect(requireCronSecret(request({ authorization: 'Bearer the-real-secret' }))).toBeNull()
  })

  it('401s a wrong secret', () => {
    process.env.CRON_SECRET = 'the-real-secret'

    expect(requireCronSecret(request({ authorization: 'Bearer wrong' }))?.status).toBe(401)
  })

  it('401s a missing header when a secret IS configured', () => {
    process.env.CRON_SECRET = 'the-real-secret'

    expect(requireCronSecret(request())?.status).toBe(401)
  })

  it('allows the explicit local-dev opt-out outside production', () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOW_UNAUTHENTICATED_CRON = 'true'

    expect(requireCronSecret(request())).toBeNull()
  })

  it('IGNORES the opt-out in production — the hole cannot be opened where it matters', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_UNAUTHENTICATED_CRON = 'true'

    expect(
      requireCronSecret(request())?.status,
      'a production environment must never accept the dev opt-out',
    ).toBe(401)
  })

  it('does not treat any truthy-looking opt-out value as consent', () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOW_UNAUTHENTICATED_CRON = '1'

    expect(requireCronSecret(request())?.status).toBe(401)
  })

  it('does not accept the secret in a query string or elsewhere', () => {
    process.env.CRON_SECRET = 'the-real-secret'
    const sneaky = new NextRequest('https://astrid.cc/api/cron/github-sync?secret=the-real-secret')

    expect(requireCronSecret(sneaky)?.status).toBe(401)
  })
})
