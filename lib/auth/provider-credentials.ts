/**
 * What each sign-in provider needs configured to work (spec §6.2).
 *
 * The boot check used to count switches and never credentials, so a deployment
 * could render a Google button with no client id behind it. Missing credentials
 * for GitHub or SSO — new, opt-in providers whose variables this file defines —
 * fail the boot. For the legacy providers they are reported but not fatal: a
 * wrong guess about which variables an existing deployment really reads would
 * turn the next deploy into an outage.
 */

import type { AuthProviderId } from '@/lib/brand/auth-providers'

const REQUIRED: Record<AuthProviderId, readonly string[]> = {
  // The brand's GitHub App's own OAuth client (Iv…), shared with installation linking.
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  sso: ['AUTH_SSO_ISSUER', 'AUTH_SSO_CLIENT_ID', 'AUTH_SSO_CLIENT_SECRET', 'AUTH_SSO_DOMAINS'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  // Nothing required: native Apple sign-in needs no server secret. See APPLE_WEB_CREDENTIALS.
  apple: [],
  passkey: [],
}

const FATAL_WHEN_MISSING: ReadonlySet<AuthProviderId> = new Set(['github', 'sso'])

/**
 * Sign in with Apple on web (AWTD-1110). Optional: Apple on iOS/Mac needs no server
 * secret, so a deployment offering Apple without these is native-only and the web
 * button is simply absent. Half of them, though, is a mistake — reported, not fatal.
 */
export const APPLE_WEB_CREDENTIALS = ['APPLE_SERVICES_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'] as const

function missingFrom(names: readonly string[], env: Record<string, string | undefined>): string[] {
  return names.filter(name => !env[name]?.trim())
}

export function hasAppleWebCredentials(env: Record<string, string | undefined> = process.env): boolean {
  return missingFrom(APPLE_WEB_CREDENTIALS, env).length === 0
}

export interface ProviderCredentialCheck {
  /** `provider: VAR, VAR` for each opt-in provider that cannot work. */
  fatal: string[]
  /** The same, for legacy providers: logged, not fatal. */
  warnings: string[]
}

export function checkProviderCredentials(
  providers: readonly AuthProviderId[],
  env: Record<string, string | undefined> = process.env,
): ProviderCredentialCheck {
  const result: ProviderCredentialCheck = { fatal: [], warnings: [] }
  for (const provider of providers) {
    let missing = missingFrom(REQUIRED[provider], env)
    if (provider === 'apple') {
      const appleWebMissing = missingFrom(APPLE_WEB_CREDENTIALS, env)
      if (appleWebMissing.length < APPLE_WEB_CREDENTIALS.length) missing = appleWebMissing
    }
    if (missing.length === 0) continue
    const line = `${provider}: ${missing.join(', ')}`
    ;(FATAL_WHEN_MISSING.has(provider) ? result.fatal : result.warnings).push(line)
  }
  return result
}
