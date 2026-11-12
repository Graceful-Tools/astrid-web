import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  formatBrandEnvDryRun,
  extractBrandPreviewUrl,
  parseBrandProfile,
  profileEnv,
  redactBrandProfileValues,
  type BrandProfile,
} from '@/lib/brand/profile'

const BRANDS_DIR = join(process.cwd(), 'brands')

const validProfile: BrandProfile = {
  name: 'Acme',
  description: 'A test partner',
  env: { NEXT_PUBLIC_BRAND_NAME: 'Acme' },
}

describe('brand profile validation (AWTD-1562)', () => {
  it('rejects unknown profile keys', () => {
    expect(() => profileEnv({ ...validProfile, unexpected: true } as never)).toThrow(/unexpected/i)
  })

  it('rejects unknown environment keys', () => {
    expect(() =>
      profileEnv({
        ...validProfile,
        env: { ...validProfile.env, NOT_A_BRAND_KEY: 'value' },
      }),
    ).toThrow(/NOT_A_BRAND_KEY/)
  })

  it('rejects an invalid app URL scheme', () => {
    expect(() =>
      profileEnv({
        ...validProfile,
        env: { NEXT_PUBLIC_BRAND_APP_URL_SCHEME: 'https://not-a-scheme.example' },
      }),
    ).toThrow(/APP_URL_SCHEME/)
  })

  it('rejects environment values with the wrong type', () => {
    expect(() =>
      profileEnv({
        ...validProfile,
        env: { NEXT_PUBLIC_BRAND_NAME: 42 },
      } as never),
    ).toThrow(/NEXT_PUBLIC_BRAND_NAME must be a string/)
  })

  it('does not echo invalid profile values from environment validators', () => {
    const profileValue = 'private-profile-content-that-must-not-be-logged'
    let message = ''
    try {
      parseBrandProfile({
        ...validProfile,
        env: { BRAND_ANDROID_APP_LINKS: profileValue },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('BRAND_ANDROID_APP_LINKS')
    expect(message).not.toContain(profileValue)
  })

  it.each([
    ['name', { description: validProfile.description, env: validProfile.env }],
    ['description', { name: validProfile.name, env: validProfile.env }],
    ['env', { name: validProfile.name, description: validProfile.description }],
  ])('requires %s', (_key, incompleteProfile) => {
    expect(() => profileEnv(incompleteProfile as never)).toThrow(/required|missing/i)
  })

  it('keeps every committed profile valid and its environment output unchanged', () => {
    const files = readdirSync(BRANDS_DIR).filter((file) => file.endsWith('.brand.json'))
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const profile = JSON.parse(readFileSync(join(BRANDS_DIR, file), 'utf8')) as BrandProfile
      expect(profileEnv(profile), file).toEqual({
        ...profile.env,
        // assets.icon is the profile's name for NEXT_PUBLIC_BRAND_ICON (AWTD-1588).
        ...(profile.assets?.icon ? { NEXT_PUBLIC_BRAND_ICON: profile.assets.icon } : {}),
        ...(profile.copy ? { NEXT_PUBLIC_BRAND_COPY: JSON.stringify(profile.copy) } : {}),
      })
    }
  })

  it('accepts assets.icon as a public/ PNG and rejects anything else (AWTD-1588)', () => {
    expect(profileEnv({ ...validProfile, assets: { icon: '/icons/acme-1024.png' } }))
      .toMatchObject({ NEXT_PUBLIC_BRAND_ICON: '/icons/acme-1024.png' })
    // /branding/ is in public/ but not traced into the icon function, so it would 404 on Vercel.
    for (const icon of ['https://cdn.example/icon.png', '/icons/icon.svg', '/../secret.png', 'icons/a.png', '/branding/a.png']) {
      expect(() => parseBrandProfile({ ...validProfile, assets: { icon } }), icon).toThrow(/assets\.icon/)
    }
    expect(() => parseBrandProfile({ ...validProfile, assets: { banner: '/b.png' } })).toThrow(/assets\.banner/)
    // Setting the variable directly is held to the same rule.
    expect(() => parseBrandProfile({ ...validProfile, env: { NEXT_PUBLIC_BRAND_ICON: 'https://cdn.example/icon.png' } }))
      .toThrow(/NEXT_PUBLIC_BRAND_ICON failed validation/)
    expect(() => parseBrandProfile({
      ...validProfile,
      env: { ...validProfile.env, NEXT_PUBLIC_BRAND_ICON: '/icons/other.png' },
      assets: { icon: '/icons/acme-1024.png' },
    })).toThrow(/disagree/)
  })

  it('keeps profile values intact in the runtime environment', () => {
    const secret = 'profile-secret-must-remain-available-at-runtime'
    expect(
      profileEnv({
        ...validProfile,
        env: { AUTH_SSO_CLIENT_SECRET: secret },
      }),
    ).toEqual({ AUTH_SSO_CLIENT_SECRET: secret })
  })

  it('redacts profile values from dry-run output', () => {
    const secret = 'profile-secret-must-never-be-logged'
    const lines = formatBrandEnvDryRun(
      ['AUTH_SSO_CLIENT_SECRET', 'NEXT_PUBLIC_BRAND_NAME', 'NEXT_PUBLIC_BRAND_OLD'],
      [
        { key: 'AUTH_SSO_CLIENT_SECRET', value: secret, why: 'profile' },
        { key: 'NEXT_PUBLIC_BRAND_NAME', value: 'Acme', why: 'profile' },
      ],
    )

    expect(lines.join('\n')).not.toContain(secret)
    expect(lines.join('\n')).not.toContain('Acme')
    expect(lines).toContainEqual(expect.stringContaining('AUTH_SSO_CLIENT_SECRET'))
    expect(lines).toContainEqual(expect.stringContaining('NEXT_PUBLIC_BRAND_OLD'))
    expect(lines.join('\n')).toContain('retained')
  })

  it('redacts profile values echoed by a deployment command', () => {
    const profileValue = 'https://partner-preview.vercel.app'
    const deploymentUrl = 'https://generated-deployment.vercel.app'

    expect(
      redactBrandProfileValues(
        `Created ${deploymentUrl}; received ${profileValue}`,
        [profileValue],
      ),
    ).toBe(`Created ${deploymentUrl}; received [redacted]`)
  })

  it('preserves generated preview URLs when a profile value overlaps the .app suffix', () => {
    const profileScheme = 'app'
    const generatedUrl = 'https://generated-deployment.vercel.app'
    expect(extractBrandPreviewUrl(`Created ${generatedUrl} for scheme ${profileScheme}`)).toBe(generatedUrl)
  })
})
