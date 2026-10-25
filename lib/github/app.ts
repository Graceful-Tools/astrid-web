/**
 * The brand's GitHub App — one instance per process (spec §7.2).
 *
 * It was constructed inline in five files. One shared instance also shares
 * Octokit's installation-token cache instead of minting a token per request.
 * Rebuilt only if its credentials change (tests swap them).
 */

import { App } from '@octokit/app'

let cached: { key: string; app: App } | null = null

export function githubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY)
}

/** The App, or a thrown error naming what is missing. Check githubAppConfigured() first. */
export function getGitHubApp(): App {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) throw new Error('GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)')

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
  const key = `${appId}:${privateKey.length}:${privateKey.slice(-16)}:${webhookSecret ?? ''}`
  if (cached?.key !== key) {
    cached = {
      key,
      app: new App({
        appId: parseInt(appId),
        privateKey,
        ...(webhookSecret && { webhooks: { secret: webhookSecret } }),
      }),
    }
  }
  return cached.app
}
