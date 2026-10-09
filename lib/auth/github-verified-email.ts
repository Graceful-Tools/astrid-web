/**
 * The primary email GitHub reports as VERIFIED for a user token, or null.
 *
 * The profile email GitHub returns can be unverified, and NextAuth's GitHub
 * provider falls back to the primary address without checking `verified`. An
 * unverified address must never name an Astrid account (spec §6.3). Needs the
 * GitHub App's "Email addresses: read" permission; without it this is null and
 * the sign-in is refused, which is the safe failure.
 */

import { createLogger } from '@/lib/logger'
import { GITHUB_API_URL } from '@/lib/github/host'

const log = createLogger('auth.github-email')

export async function githubVerifiedPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API_URL}/user/emails`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      log.warn({ status: res.status }, 'Could not read GitHub emails; refusing to trust the address')
      return null
    }
    const emails = (await res.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
    return emails.find(e => e.primary && e.verified)?.email ?? null
  } catch (err) {
    log.warn({ err }, 'GitHub email lookup failed; refusing to trust the address')
    return null
  }
}
