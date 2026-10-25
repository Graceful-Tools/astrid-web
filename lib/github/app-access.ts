/**
 * "Refresh my access" for the brand's GitHub App (spec §7.2–§7.3, AWTD-1302).
 *
 * Given the user's own App token, store it (the `Integration[GITHUB]` slot,
 * lib/github/user-tokens.ts) and grant access to every installation GitHub
 * lists for it in `GET /user/installations`. That listing is the only proof
 * of access there is (AWTD-1087), so this grants exactly what GitHub says.
 *
 * Two callers:
 *   - sign-in with GitHub, which goes through the App's own OAuth client, so
 *     one consent gives the session AND the user-to-server token (§7.2);
 *   - the setup route's sync leg, for a user who signed in some other way, or
 *     whose org installed the App after they signed in.
 *
 * It only grants. Access to an installation GitHub no longer lists is left to
 * the installation webhook and disconnect, as before.
 */

import { hasCapability } from '@/lib/brand/capabilities'
import { listUserInstallations } from '@/lib/github/installation-access'
import { grantInstallationAccess, recordInstallation } from '@/lib/github/installations'
import { storeGithubAppUserToken, type GithubAppUserTokenSet } from '@/lib/github/user-tokens'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.app-access')

/** Store the token and grant every installation GitHub lists; answers the granted ids. */
export async function syncGithubAppAccess(
  userId: string,
  tokens: GithubAppUserTokenSet,
  githubUserId?: string | null,
): Promise<number[]> {
  await storeGithubAppUserToken(userId, tokens, githubUserId)

  const installations = await listUserInstallations(tokens.access_token)
  if (!installations) {
    log.warn({ userId }, 'GitHub would not list installations for the user token')
    return []
  }

  const granted: number[] = []
  for (const installation of installations) {
    const login = installation.account?.login ?? installation.account?.name
    await recordInstallation({
      installationId: installation.id,
      account: login
        ? { login, type: installation.account?.type ?? null, nodeId: installation.account?.node_id ?? null }
        : null,
      repositorySelection: installation.repository_selection ?? null,
    })
    await grantInstallationAccess(userId, installation.id)
    granted.push(installation.id)
  }
  return granted
}

/** The token-bearing account NextAuth hands the signIn event. */
export interface SignInAccount {
  provider: string
  providerAccountId: string
  access_token?: string | null
  refresh_token?: string | null
  /** Absolute, in seconds (openid-client derives it from expires_in). */
  expires_at?: number | null
  expires_in?: number | null
  refresh_token_expires_in?: number | null
  scope?: string | null
}

function tokenSetFrom(account: SignInAccount): GithubAppUserTokenSet | null {
  if (!account.access_token) return null
  const expiresIn =
    typeof account.expires_in === 'number'
      ? account.expires_in
      : typeof account.expires_at === 'number'
        ? Math.max(0, Math.round(account.expires_at - Date.now() / 1000))
        : undefined
  return {
    access_token: account.access_token,
    ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
    ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
    ...(typeof account.refresh_token_expires_in === 'number'
      ? { refresh_token_expires_in: account.refresh_token_expires_in }
      : {}),
    ...(account.scope ? { scope: account.scope } : {}),
  }
}

/**
 * Called from the NextAuth signIn event. GitHub sign-in uses the App's own
 * client (lib/auth-config.ts), so its token is a user-to-server token. Never
 * throws: a sign-in must not fail because GitHub was slow to list installations.
 */
export async function connectGithubAppAtSignIn(userId: string, account: SignInAccount): Promise<void> {
  if (account.provider !== 'github' || !hasCapability('githubConnection')) return
  const tokens = tokenSetFrom(account)
  if (!tokens) return
  try {
    const granted = await syncGithubAppAccess(userId, tokens, account.providerAccountId)
    log.info({ userId, installations: granted.length }, 'GitHub App access synced at sign-in')
  } catch (err) {
    log.error({ err, userId }, 'Failed to sync GitHub App access at sign-in')
  }
}
