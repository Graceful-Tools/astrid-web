/**
 * Trade an authorization code for a provider token and file it on a user.
 *
 * The step every connect path ends with, in one place. There are now four ways
 * a GitHub/Google/Copilot link can finish — the browser callback, the
 * app-completed `/complete` POST, the resume-after-sign-in route, and whatever
 * comes next — and they were each hand-rolling the same exchange, the same
 * account lookup, and the same store call. The security rules that matter here
 * (never log the exchange response; refuse a Google grant that dropped the
 * tasks scope) held in every copy only by everyone remembering them.
 *
 * The CALLER decides whose account `userId` is; this never reads a `state`.
 * That is deliberate — deciding the owner from a forgeable state is task
 * 842601f2's whole vulnerability.
 *
 * Callers keep their own copy for the user, because a browser page, a JSON API
 * and a native app phrase the same outcome differently. This returns the
 * outcome, not the words.
 */

import { createLogger } from '@/lib/logger'
import { exchangeGithubCode, githubRequest, storeGithubIntegration } from '@/lib/sync/github'
import { exchangeGoogleCode, storeGoogleIntegration } from '@/lib/sync/google'
import { exchangeCopilotCode, githubLoginFor, storeCopilotCredential } from '@/lib/copilot/oauth'
import type { OAuthStateProvider } from '@/lib/sync/oauth-state'

const log = createLogger('integrations.link')

export type LinkFailure = 'exchange_failed' | 'lookup_failed' | 'scope_missing'

export type LinkResult =
  | { ok: true; account: string | null }
  | { ok: false; reason: LinkFailure }

/**
 * @param userId the account the token is filed on — never derived from a state.
 * @param redirectUri echoed to the provider when the code was issued against one.
 */
export async function completeIntegrationLink(
  provider: OAuthStateProvider,
  userId: string,
  code: string,
  redirectUri?: string,
): Promise<LinkResult> {
  switch (provider) {
    case 'github':
      return linkGithub(userId, code, redirectUri)
    case 'google':
      return linkGoogle(userId, code, redirectUri)
    case 'copilot':
      return linkCopilot(userId, code, redirectUri)
  }
}

async function linkGithub(userId: string, code: string, redirectUri?: string): Promise<LinkResult> {
  const token = await exchangeGithubCode(code, redirectUri)
  if (!token) {
    // The response is never logged: a partial grant still carries a
    // refresh_token and pino has no redaction configured (task 842601f2).
    log.error({ userId, provider: 'github' }, 'Token exchange failed')
    return { ok: false, reason: 'exchange_failed' }
  }

  const { status, json: user } = await githubRequest(token.accessToken, 'GET', '/user')
  if (status !== 200 || !user?.login) {
    return { ok: false, reason: 'lookup_failed' }
  }

  await storeGithubIntegration(userId, token.accessToken, user.login, token.scopes)
  log.info({ userId, login: user.login }, 'GitHub sync connected')
  return { ok: true, account: String(user.login) }
}

async function linkGoogle(userId: string, code: string, redirectUri?: string): Promise<LinkResult> {
  // Google, unlike GitHub, requires the redirect_uri echoed on the exchange, so
  // every Google caller must carry the one the code was issued against.
  if (!redirectUri) {
    log.error({ userId, provider: 'google' }, 'Google link is missing the redirect_uri the code was issued against')
    return { ok: false, reason: 'exchange_failed' }
  }

  const tokens = await exchangeGoogleCode(code, redirectUri)

  // Granular consent: the user can UNCHECK the Tasks permission on Google's
  // consent screen. A token without the tasks scope 403s on every call, so
  // catch it here rather than in an empty tasklist picker.
  if (tokens?.access_token && tokens.scope && !tokens.scope.includes('auth/tasks')) {
    return { ok: false, reason: 'scope_missing' }
  }
  if (!tokens?.access_token) {
    log.error({ userId, provider: 'google' }, 'Token exchange failed')
    return { ok: false, reason: 'exchange_failed' }
  }

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json().catch(() => null)

  await storeGoogleIntegration(userId, tokens.access_token, tokens.refresh_token, tokens.expires_in, info?.email ?? null)
  log.info({ userId, email: info?.email }, 'Google Tasks sync connected')
  return { ok: true, account: info?.email ?? null }
}

async function linkCopilot(userId: string, code: string, redirectUri?: string): Promise<LinkResult> {
  const token = await exchangeCopilotCode(code, redirectUri)
  if (!token) {
    log.error({ userId, provider: 'copilot' }, 'Token exchange failed')
    return { ok: false, reason: 'exchange_failed' }
  }

  const login = await githubLoginFor(token.accessToken)
  await storeCopilotCredential(userId, token, login)
  log.info({ userId, login }, 'GitHub Copilot connected')
  return { ok: true, account: login ?? null }
}
