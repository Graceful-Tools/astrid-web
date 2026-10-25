/**
 * The GitHub App's user-to-server tokens (AWTD-1112, spec §7.2/§7.4).
 *
 * Stored in the encrypted Integration store under provider GITHUB: an access
 * token (8h when the App has token expiration on), a refresh token (6 months),
 * and when the access token expires. Refreshed on use.
 *
 * A user's write goes out as that user or not at all: when the token cannot be
 * refreshed this answers null, and the caller falls back to the user's own
 * legacy OAuth token — never to an installation token, which would make the
 * write look like the App's own. A rule test pins that this file never reaches
 * for the App or an installation.
 */

import { prisma } from '@/lib/prisma'
import { decryptFieldStrict, encryptField } from '@/lib/field-encryption'
import { GITHUB_WEB_URL } from '@/lib/github/host'
import { githubAppOAuthCredentials } from '@/lib/github/installation-access'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.user-tokens')

/** Refresh this long before expiry, so a token never expires mid-request. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** GitHub's token response (code exchange and refresh share it). */
export interface GithubAppUserTokenSet {
  access_token: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
}

function expiryFrom(seconds: number | undefined): Date | null {
  return typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null
}

function tokenFields(tokens: GithubAppUserTokenSet) {
  return {
    accessToken: encryptField(tokens.access_token),
    refreshToken: tokens.refresh_token ? encryptField(tokens.refresh_token) : null,
    expiresAt: expiryFrom(tokens.expires_in),
    ...(tokens.refresh_token_expires_in
      ? { metadata: { refreshTokenExpiresAt: expiryFrom(tokens.refresh_token_expires_in)?.toISOString() } }
      : {}),
  }
}

export async function storeGithubAppUserToken(
  userId: string,
  tokens: GithubAppUserTokenSet,
  login?: string | null,
): Promise<void> {
  const fields = tokenFields(tokens)
  const scopes = tokens.scope ? tokens.scope.split(',').filter(Boolean) : []
  await prisma.integration.upsert({
    where: { userId_provider: { userId, provider: 'GITHUB' } },
    create: { userId, provider: 'GITHUB', ...fields, scopes, externalAccountId: login ?? null },
    update: { ...fields, scopes, revokedAt: null, ...(login ? { externalAccountId: login } : {}) },
  })
}

async function refresh(integrationId: string, refreshToken: string): Promise<string | null> {
  const credentials = githubAppOAuthCredentials()
  if (!credentials) return null
  try {
    const res = await fetch(`${GITHUB_WEB_URL}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    // GitHub answers 200 with { error } for a bad refresh token. Never log the
    // body: a partial grant still carries tokens.
    const body = (res.ok ? await res.json() : null) as (GithubAppUserTokenSet & { error?: string }) | null
    if (!body?.access_token) {
      log.warn({ integrationId, status: res.status, error: body?.error }, 'GitHub App user token refresh refused')
      return null
    }
    await prisma.integration.update({ where: { id: integrationId }, data: tokenFields(body) })
    return body.access_token
  } catch (err) {
    log.error({ err, integrationId }, 'GitHub App user token refresh failed')
    return null
  }
}

/** The user's App token, refreshed if it is about to expire; null if there is none usable. */
export async function githubAppUserTokenFor(userId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'GITHUB' } },
  })
  if (!integration?.accessToken || integration.revokedAt) return null

  const expiring = integration.expiresAt && integration.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS
  if (!expiring) {
    try {
      return decryptFieldStrict(integration.accessToken)
    } catch {
      return null
    }
  }

  let refreshToken: string | null = null
  try {
    refreshToken = decryptFieldStrict(integration.refreshToken)
  } catch {
    refreshToken = null
  }
  return refreshToken ? refresh(integration.id, refreshToken) : null
}
