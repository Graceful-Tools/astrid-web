/**
 * Which sign-in providers a deployment offers, in the order it shows them.
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §6.2. Login providers are a
 * standard part of white-label configuration — one ordered list,
 * `NEXT_PUBLIC_BRAND_AUTH_PROVIDERS="github,google,apple,passkey,sso"`.
 *
 * Pure and client-safe: lib/brand/capabilities.ts reads the variable (literally,
 * so Next inlines it) and hands it here.
 *
 * The rules:
 *   - Unset or empty: derived from the three legacy switches
 *     (NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE / _APPLE / _PASSKEY), so a
 *     deployment that sets nothing offers exactly what it did before.
 *   - Set: taken as given, in order. Unknown names and repeats are dropped.
 *   - A new provider (GitHub, SSO) is never on by default. Listing it is the
 *     only way in — the legacy "on unless switched off" convention must not
 *     apply to a provider that needs credentials, or every existing deployment
 *     would sprout buttons that fail.
 *   - A legacy switch set to off still removes its provider from an explicit
 *     list, so a deployment that turned Google off stays that way.
 */

export const AUTH_PROVIDER_IDS = ['github', 'google', 'apple', 'passkey', 'sso'] as const
export type AuthProviderId = (typeof AUTH_PROVIDER_IDS)[number]

/** How each provider signs a user in — what a client needs to pick the flow. */
export const AUTH_PROVIDER_KINDS: Record<AuthProviderId, 'oauth' | 'oidc' | 'webauthn'> = {
  github: 'oauth',
  google: 'oauth',
  apple: 'oauth',
  passkey: 'webauthn',
  sso: 'oidc',
}

/** The three providers that predate the list, and their switches' values. */
export interface LegacyAuthSwitches {
  google: boolean
  apple: boolean
  passkey: boolean
}

const LEGACY_ORDER = ['google', 'apple', 'passkey'] as const

function isProviderId(value: string): value is AuthProviderId {
  return (AUTH_PROVIDER_IDS as readonly string[]).includes(value)
}

export function resolveAuthProviders(list: string | undefined, legacy: LegacyAuthSwitches): AuthProviderId[] {
  const named = (list ?? '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)

  if (named.length === 0) {
    return LEGACY_ORDER.filter(id => legacy[id])
  }

  const resolved: AuthProviderId[] = []
  for (const name of named) {
    if (!isProviderId(name) || resolved.includes(name)) continue
    if (name in legacy && !legacy[name as keyof LegacyAuthSwitches]) continue
    resolved.push(name)
  }
  return resolved
}
