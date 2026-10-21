/**
 * GitHub App setup handler for post-installation.
 *
 * GitHub sends the browser here after the App is installed or reconfigured,
 * with `installation_id` in the query string. That id is NOT proof — anyone can
 * type any id into this URL — so it only starts a verification round trip
 * (AWTD-1087):
 *
 *   1. `?installation_id=…` → redirect to GitHub to authorize the App as the
 *      signed-in user, with a signed state naming this user and installation.
 *   2. `?code=…&state=…`    → exchange the code for the user's own token and
 *      link the installation only if `GET /user/installations` lists it.
 *
 * With no App OAuth credentials configured there is nothing to verify with,
 * and the link is refused rather than trusted.
 *
 * `?sync=1` is "refresh my access" (spec §7.3, AWTD-1302): the same authorize
 * round trip with no installation named, after which every installation GitHub
 * lists for the user is granted (lib/github/app-access.ts). It is how a user
 * whose org already has the App — or who signed in some other way — connects.
 * `&return=/path` brings them back to a same-site page instead of Settings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { getGitHubApp } from '@/lib/github/app'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'
import { mintOAuthStateWithSubject, verifyOAuthStateWithSubject } from '@/lib/sync/oauth-state'
import {
  exchangeGithubAppCode,
  githubAppAuthorizeUrl,
  githubAppOAuthCredentials,
  userCanAccessInstallation,
} from '@/lib/github/installation-access'
import {
  grantInstallationAccess,
  recordInstallation,
  replaceInstallationRepos,
  type InstallationAccount,
} from '@/lib/github/installations'
import { storeGithubAppUserToken } from '@/lib/github/user-tokens'
import { syncGithubAppAccess } from '@/lib/github/app-access'

const log = createLogger('github.setup')

function settingsRedirect(request: NextRequest, github?: string) {
  // The one GitHub card lives on Connections (AWTD-1114); it reads ?github=.
  const path = github ? `/settings/connections?github=${github}` : '/settings/connections'
  return NextResponse.redirect(new URL(path, request.url))
}

/** The state subject for the sync leg; a return path rides along, encoded. */
const SYNC_SUBJECT = 'sync'

/** A same-site path to come back to, or null. Never another origin. */
function safeReturnPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw.length <= 512 ? raw : null
}

function syncSubject(returnPath: string | null): string {
  return returnPath ? `${SYNC_SUBJECT}-${Buffer.from(returnPath).toString('base64url')}` : SYNC_SUBJECT
}

/** The sync leg's subject → its return path (null for Settings); undefined if not a sync subject. */
function parseSyncSubject(subject: string): string | null | undefined {
  if (subject === SYNC_SUBJECT) return null
  if (!subject.startsWith(`${SYNC_SUBJECT}-`)) return undefined
  try {
    return safeReturnPath(Buffer.from(subject.slice(SYNC_SUBJECT.length + 1), 'base64url').toString())
  } catch {
    return null
  }
}

function setupRedirectUri(request: NextRequest): string {
  return new URL('/api/github/setup', request.url).toString()
}

interface FetchedInstallation {
  account: InstallationAccount | null
  repositorySelection: string | null
  /** The legacy GitHubIntegration.repositories shape. */
  repositories: any[]
}

async function fetchInstallation(installationId: number): Promise<FetchedInstallation> {
  const empty: FetchedInstallation = { account: null, repositorySelection: null, repositories: [] }
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) return empty
  try {
    const app = getGitHubApp()
    const installationOctokit = await app.getInstallationOctokit(installationId)
    const reposResponse = await installationOctokit.request('GET /installation/repositories')
    const installationDetails = await app.octokit.request('GET /app/installations/{installation_id}', {
      installation_id: installationId
    })
    const account = installationDetails.data.account as any
    const owner = account?.login || account?.name || 'unknown'
    return {
      account: { login: owner, type: account?.type ?? null, nodeId: account?.node_id ?? null },
      repositorySelection: (installationDetails.data as any).repository_selection ?? null,
      repositories: reposResponse.data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch || 'main',
        private: repo.private,
        nodeId: repo.node_id,
        installationId,
        owner
      }))
    }
  } catch (error) {
    log.error({ err: error }, 'Error fetching repositories:')
    // Continue without repos - they can be fetched later
    return empty
  }
}

export async function GET(request: NextRequest) {
  // The App connection, not the coding agent: a GitHub Projects brand needs it
  // with the coding agent off (AWTD-1302). Refused, server-side, when neither
  // is on (task 229c175c).
  const capabilityBlocked = capabilityGate('githubConnection')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const { searchParams } = new URL(request.url)
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.redirect(new URL('/auth/signin', request.url))
    }
    const userId = session.user.id

    const credentials = githubAppOAuthCredentials()
    const code = searchParams.get('code')
    const verified = code ? verifyOAuthStateWithSubject(searchParams.get('state') ?? '', 'github-app') : null

    // Leg 2: GitHub sent the user back after authorizing the App as themselves.
    if (code && verified) {
      if (!credentials) return settingsRedirect(request, 'verification_unavailable')
      if (verified.userId !== userId) {
        log.warn('GitHub setup state was minted for a different user')
        return settingsRedirect(request, 'not_authorized')
      }

      // The sync leg: grant whatever GitHub lists for this user's own token.
      const syncReturn = parseSyncSubject(verified.subject)
      if (syncReturn !== undefined) {
        const userTokens = await exchangeGithubAppCode(credentials, code, setupRedirectUri(request))
        if (!userTokens) return settingsRedirect(request, 'not_authorized')
        const granted = await syncGithubAppAccess(userId, userTokens)
        log.info({ userId, installations: granted.length }, 'GitHub App access synced')
        const back = syncReturn ? new URL(syncReturn, request.url) : null
        // Belt and braces: the URL parser drops tabs and newlines, so check
        // where the path actually resolves, not just how it starts.
        return back && back.origin === new URL(request.url).origin
          ? NextResponse.redirect(back)
          : settingsRedirect(request, 'synced')
      }

      const installationId = Number(verified.subject)
      const userTokens = await exchangeGithubAppCode(credentials, code, setupRedirectUri(request))
      if (!userTokens || !(await userCanAccessInstallation(userTokens.access_token, installationId))) {
        log.warn({ installationId }, 'User cannot see the GitHub installation they tried to link')
        return settingsRedirect(request, 'not_authorized')
      }

      // Kept from before verification existed: one Astrid user per installation.
      const existingConnection = await prisma.gitHubIntegration.findFirst({
        where: { installationId, userId: { not: userId } }
      })
      if (existingConnection) {
        log.info(`⚠️ Installation ${installationId} already connected to another user`)
        return settingsRedirect(request, 'already_connected')
      }

      const { account, repositorySelection, repositories } = await fetchInstallation(installationId)
      const existing = await prisma.gitHubIntegration.findFirst({ where: { userId, installationId } })
      await prisma.gitHubIntegration.upsert({
        where: { userId_installationId: { userId, installationId } },
        create: {
          userId,
          installationId,
          appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID) : null,
          isSharedApp: true,
          repositories
        },
        update: {
          appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID) : null,
          isSharedApp: true,
          repositories
        }
      })

      // GitHub has just listed this installation for the user's own token: the
      // one place access is granted (AWTD-1111, spec §7.3). Best effort while
      // GitHubIntegration (written above) is still what the agent falls back
      // to: the link is made either way.
      try {
        await recordInstallation({ installationId, account, repositorySelection })
        if (account) await replaceInstallationRepos(installationId, repositories)
        await grantInstallationAccess(userId, installationId)
        // The user's own App token: Issues sync uses it for repos an
        // installation reaches (AWTD-1112).
        await storeGithubAppUserToken(userId, userTokens)
      } catch (err) {
        log.error({ err, installationId }, 'Failed to record the installation model; the legacy link is saved')
      }

      log.info(`✅ GitHub App linked for user ${userId}, installation ${installationId}, ${repositories.length} repos`)
      return settingsRedirect(request, existing ? 'updated' : 'connected')
    }

    // Leg 1: GitHub names an installation. Ask the user to prove they can see it.
    const setupAction = searchParams.get('setup_action')
    const installationParam = searchParams.get('installation_id')
    if ((setupAction === 'install' || setupAction === 'update') && installationParam && /^\d+$/.test(installationParam)) {
      if (!credentials) {
        log.error('GitHub App OAuth credentials (GITHUB_CLIENT_ID/SECRET) are not configured; cannot verify installation access')
        return settingsRedirect(request, 'verification_unavailable')
      }
      const state = mintOAuthStateWithSubject(userId, 'github-app', installationParam)
      return NextResponse.redirect(githubAppAuthorizeUrl(credentials, state, setupRedirectUri(request)))
    }

    if (searchParams.get('sync') === '1') {
      if (!credentials) return settingsRedirect(request, 'verification_unavailable')
      const subject = syncSubject(safeReturnPath(searchParams.get('return')))
      const state = mintOAuthStateWithSubject(userId, 'github-app', subject)
      return NextResponse.redirect(githubAppAuthorizeUrl(credentials, state, setupRedirectUri(request)))
    }

    return settingsRedirect(request)
  } catch (error) {
    log.error({ err: error }, 'Error handling GitHub setup:')
    return settingsRedirect(request, 'error')
  }
}
