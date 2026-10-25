/**
 * P2 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md §6.2 — login providers are a
 * standard part of white-label configuration.
 *
 * One ordered list, NEXT_PUBLIC_BRAND_AUTH_PROVIDERS, names the providers a
 * deployment offers and the order their buttons appear in. Unset, the list is
 * derived from the three legacy switches, so a deployment that sets nothing —
 * Astrid — offers exactly what it offers today.
 */

import { describe, it, expect } from 'vitest'
import { resolveAuthProviders, AUTH_PROVIDER_IDS } from '@/lib/brand/auth-providers'

const allLegacyOn = { google: true, apple: true, passkey: true }

describe('resolveAuthProviders', () => {
  it('derives Astrid’s exact set from the legacy switches when the list is unset', () => {
    expect(resolveAuthProviders(undefined, allLegacyOn)).toEqual(['google', 'apple', 'passkey'])
    expect(resolveAuthProviders('', allLegacyOn)).toEqual(['google', 'apple', 'passkey'])
    expect(resolveAuthProviders(undefined, { google: false, apple: false, passkey: true })).toEqual(['passkey'])
  })

  it('takes the list as given, in order — the order is the button order', () => {
    expect(resolveAuthProviders('github,sso', allLegacyOn)).toEqual(['github', 'sso'])
    expect(resolveAuthProviders('passkey, GitHub ,google', allLegacyOn)).toEqual(['passkey', 'github', 'google'])
  })

  it('never turns a new provider on by default — only listing enables it', () => {
    expect(resolveAuthProviders(undefined, allLegacyOn)).not.toContain('github')
    expect(resolveAuthProviders(undefined, allLegacyOn)).not.toContain('sso')
  })

  it('lets a legacy switch still remove its provider from an explicit list', () => {
    expect(resolveAuthProviders('google,github', { google: false, apple: true, passkey: true })).toEqual(['github'])
  })

  it('drops unknown names and duplicates rather than failing', () => {
    expect(resolveAuthProviders('github,okta,github,passkey', allLegacyOn)).toEqual(['github', 'passkey'])
  })

  it('knows the five providers the spec names', () => {
    expect([...AUTH_PROVIDER_IDS].sort()).toEqual(['apple', 'github', 'google', 'passkey', 'sso'])
  })
})
