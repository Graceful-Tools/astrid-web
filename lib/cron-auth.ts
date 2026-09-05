import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Authorization for the scheduled cron routes. **Fails closed.**
 *
 * Task 2f4babb1. All five routes previously inlined this:
 *
 *     if (process.env.CRON_SECRET && authHeader !== `Bearer ${...}`) return 401
 *
 * which only guards when the secret happens to be set. Miss it in the
 * environment — or misspell it — and `&&` short-circuits, turning every cron
 * route into a public, unauthenticated GET.
 *
 * That is not a theoretical precondition here. ASTRID.md's working agreements
 * already record recurring 401s traced to env vars missing AT DEPLOY TIME. The
 * old pattern converted an ordinary configuration slip into an open door.
 *
 * The cost of the safe direction is silence, and it was paid in full: with no
 * CRON_SECRET on the Vercel project, every scheduled route 401'd from
 * 2026-08-19 until a log review found it weeks later (task a5eb65a4). Failing
 * closed is still right — the alternative was an open door — but "an operator
 * notices and fixes it" is not automatic. `/api/health` now reports
 * `cronSecretConfigured` and `npm run deploy:canary` warns on it, which is the
 * part that was missing.
 *
 * `GET /api/cron/github-sync` shows the stakes: it runs every 15 minutes and
 * calls syncAllGithubLinks(), which walks EVERY user's ExternalListLink,
 * fetches each owner's GitHub token, and both pushes to and pulls from their
 * repos. Unauthenticated, an anonymous caller could drive all-tenant GitHub
 * traffic on a loop.
 *
 * So: no secret configured means nobody gets in. An unset secret breaks the
 * cron jobs loudly, which an operator notices and fixes, instead of quietly
 * opening them to everyone.
 *
 * Usage — replaces the copy-pasted block in all five routes
 * (docs/CODE_REUSE_AND_CONSISTENCY.md):
 *
 *     const blocked = requireCronSecret(request)
 *     if (blocked) return blocked
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    // The only way through without a secret is an EXPLICIT local opt-out, and
    // never in production — the environment where the hole would matter is the
    // one environment that cannot open it.
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_UNAUTHENTICATED_CRON === 'true'
    ) {
      return null
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Header only. A secret in a query string lands in logs, browser history and
  // referrers, so it is not accepted as an alternative.
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
