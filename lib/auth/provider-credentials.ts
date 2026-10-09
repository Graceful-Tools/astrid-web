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
  apple: [],
  passkey: [],
}

const FATAL_WHEN_MISSING: ReadonlySet<AuthProviderId> = new Set(['github', 'sso'])

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
    const missing = REQUIRED[provider].filter(name => !env[name]?.trim())
    if (missing.length === 0) continue
    const line = `${provider}: ${missing.join(', ')}`
    ;(FATAL_WHEN_MISSING.has(provider) ? result.fatal : result.warnings).push(line)
  }
  return result
}
