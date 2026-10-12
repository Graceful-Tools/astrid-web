/**
 * GitHub failures as v1 errors (spec §11.2's table), for the Projects routes.
 *
 *   rate limit (ours or GitHub's)   429 rate_limited + retryAfter (seconds)
 *   401 / unusable user token       403 auth_required — reconnect GitHub
 *   403 / 404                       403 forbidden
 *   5xx / timeout                   502 upstream_unavailable
 *
 * auth_required is a 403, not a 401: a 401 from Astrid means "your Astrid
 * session is gone", and clients sign out on it.
 */

import { NextResponse } from 'next/server'
import type { GitHubGraphqlError, GitHubRateLimitedError } from '../rate-limiter'

export function githubAuthRequired(): NextResponse {
  return NextResponse.json(
    { error: 'auth_required', message: 'Reconnect GitHub to continue.' },
    { status: 403 },
  )
}

// By name, not instanceof: a bundler (or a test's module reset) can hold two
// copies of the module, and an error from one is not an instance of the other.
const isRateLimited = (err: unknown): err is GitHubRateLimitedError =>
  err instanceof Error && err.name === 'GitHubRateLimitedError'
const isGraphqlError = (err: unknown): err is GitHubGraphqlError =>
  err instanceof Error && err.name === 'GitHubGraphqlError'

export function githubErrorResponse(err: unknown): NextResponse | null {
  if (isRateLimited(err)) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: Math.ceil(err.retryAfterMs / 1000) },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(err.retryAfterMs / 1000)) } },
    )
  }
  if (isGraphqlError(err)) {
    if (err.status === 401) return githubAuthRequired()
    if (err.status === 403 || err.status === 404) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    if (err.status >= 500) return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 })
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 })
  }
  return null
}
