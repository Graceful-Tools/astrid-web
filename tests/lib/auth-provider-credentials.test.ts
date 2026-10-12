/**
 * P2 (spec §6.2) — a provider that is listed must have what it needs to work.
 * Switches used to be checked, credentials never: a deployment could offer a
 * Google button with no client id. GitHub and SSO, which are new and opt-in,
 * fail the boot; the legacy providers are reported, not fatal, because a wrong
 * guess about an existing deployment's variables would be an outage.
 */

import { describe, it, expect } from 'vitest'
import { checkProviderCredentials, hasAppleWebCredentials } from '@/lib/auth/provider-credentials'

describe('checkProviderCredentials', () => {
  it('passes a provider with its credentials', () => {
    expect(checkProviderCredentials(['github'], { GITHUB_CLIENT_ID: 'Iv23x', GITHUB_CLIENT_SECRET: 's' }))
      .toEqual({ fatal: [], warnings: [] })
  })

  it('is fatal for a listed GitHub with no App OAuth client', () => {
    const result = checkProviderCredentials(['github'], {})
    expect(result.fatal).toEqual(['github: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET'])
  })

  it('is fatal for SSO missing any of its settings', () => {
    const result = checkProviderCredentials(['sso'], { AUTH_SSO_ISSUER: 'https://idp', AUTH_SSO_CLIENT_ID: 'c' })
    expect(result.fatal).toEqual(['sso: AUTH_SSO_CLIENT_SECRET, AUTH_SSO_DOMAINS'])
  })

  it('only warns for a legacy provider, so an existing deployment never fails to boot on a guess', () => {
    const result = checkProviderCredentials(['google'], {})
    expect(result.fatal).toEqual([])
    expect(result.warnings).toEqual(['google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET'])
  })

  // AWTD-1110: Apple on iOS/Mac needs no server secret, so none of the web set is
  // required — but half of it is a mistake worth saying out loud.
  it('accepts Apple with no web credentials at all (native sign-in only)', () => {
    expect(checkProviderCredentials(['apple'], {})).toEqual({ fatal: [], warnings: [] })
  })

  it('warns when the web Apple credentials are only partly set', () => {
    const result = checkProviderCredentials(['apple'], { APPLE_SERVICES_ID: 'cc.astrid.web', APPLE_TEAM_ID: 'T' })
    expect(result.fatal).toEqual([])
    expect(result.warnings).toEqual(['apple: APPLE_KEY_ID, APPLE_PRIVATE_KEY'])
  })

  it('reports whether web Apple sign-in is fully configured', () => {
    const full = { APPLE_SERVICES_ID: 's', APPLE_TEAM_ID: 't', APPLE_KEY_ID: 'k', APPLE_PRIVATE_KEY: 'p' }
    expect(hasAppleWebCredentials(full)).toBe(true)
    expect(hasAppleWebCredentials({ ...full, APPLE_PRIVATE_KEY: ' ' })).toBe(false)
  })

  it('treats blank values as missing', () => {
    expect(checkProviderCredentials(['github'], { GITHUB_CLIENT_ID: ' ', GITHUB_CLIENT_SECRET: 's' }).fatal)
      .toEqual(['github: GITHUB_CLIENT_ID'])
  })
})
