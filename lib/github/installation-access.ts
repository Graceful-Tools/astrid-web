/**
 * Proof that an Astrid user can see a GitHub App installation (AWTD-1087).
 *
 * The only acceptable proof is GitHub's own answer: the user authorizes the
 * App (user-to-server OAuth), and the installation appears in
 * `GET /user/installations` for that token. Everything the installation flow
 * used to rely on — "no other Astrid user has claimed it", an `installation_id`
 * in a query string, an unsigned `state` — is attacker-controlled.
 *
 * The App's OAuth credentials are `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
 * (the GitHub App's own client, `Iv…` — not the Issues-sync OAuth App, which is
 * `GITHUB_SYNC_CLIENT_ID`).
 */

import { GITHUB_API_URL as GITHUB_API, GITHUB_WEB_URL as GITHUB_WEB } from '@/lib/github/host'

const PAGE_SIZE = 100
/** /user/installations is paginated; nobody legitimately sees more than this. */
const MAX_PAGES = 10

export interface GithubAppOAuthCredentials {
  clientId: string
  clientSecret: string
}

export function githubAppOAuthCredentials(): GithubAppOAuthCredentials | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Where to send the browser so the user authorizes the App as themselves. */
export function githubAppAuthorizeUrl(
  credentials: GithubAppOAuthCredentials,
  state: string,
  redirectUri: string,
): string {
  const url = new URL('/login/oauth/authorize', GITHUB_WEB)
  url.searchParams.set('client_id', credentials.clientId)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri)
  return url.toString()
}

/** Exchange an authorization code for a user-to-server token, or null. */
export async function exchangeGithubAppCode(
  credentials: GithubAppOAuthCredentials,
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const res = await fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { access_token?: string }
  return body.access_token || null
}

/** Does GitHub list this installation for the token's user? */
export async function userCanAccessInstallation(userToken: string, installationId: number): Promise<boolean> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${GITHUB_API}/user/installations?per_page=${PAGE_SIZE}&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${userToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { installations?: Array<{ id: number }> }
    const installations = body.installations ?? []
    if (installations.some(inst => inst.id === installationId)) return true
    if (installations.length < PAGE_SIZE) return false
  }
  return false
}
