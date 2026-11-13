/**
 * AWTD-1589: one profile carries every platform's block, and the web accepts all of them
 * without shipping any.
 *
 * astrid-windows reads a `windows` block from the same brands/*.brand.json
 * (scripts/lib/brand-profile.ps1), but the parser failed closed on it, so the one profile
 * that was meant to describe a partner on every platform could not exist. Android, the
 * VS Code extension and Astrid Code each get a block too, so acme can exercise all of them.
 *
 * The blocks are a client's own build identity — package names, publisher certificates,
 * application ids — so the other half of accepting them is that none reaches a web
 * deployment's environment.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBrandProfile, profileEnv, NON_ENV_PROFILE_KEYS } from '@/lib/brand/profile'

const BASE = { name: 'Acme', description: 'a partner on every platform', env: { NEXT_PUBLIC_BRAND_NAME: 'Acme' } }
const PLATFORMS = ['ios', 'windows', 'android', 'vscode', 'code'] as const

describe('platform blocks in a brand profile (AWTD-1589)', () => {
  it('accepts the Windows block astrid-windows reads', () => {
    const profile = parseBrandProfile({
      ...BASE,
      windows: {
        publisherDisplayName: 'Acme Corporation',
        identityName: 'AcmeCorporation.AcmeTasks',
        identityPublisher: 'CN=00000000-0000-0000-0000-000000000000',
        assets: 'acme-assets',
      },
    })
    expect(profile.windows?.identityName).toBe('AcmeCorporation.AcmeTasks')
  })

  it('accepts Android values under brand.properties names', () => {
    const profile = parseBrandProfile({ ...BASE, android: { applicationId: 'example.acme.tasks', accentColor: '#7e22ce' } })
    expect(profile.android?.applicationId).toBe('example.acme.tasks')
  })

  it('accepts any string key in the vscode and code blocks until core names them', () => {
    expect(parseBrandProfile({ ...BASE, vscode: { publisher: 'acme' }, code: { nameShort: 'Acme Code' } }).code)
      .toEqual({ nameShort: 'Acme Code' })
  })

  it('still fails closed on a misspelt key where a reader defines the keys', () => {
    expect(() => parseBrandProfile({ ...BASE, windows: { identityname: 'x' } })).toThrow(/windows\.identityname/)
    expect(() => parseBrandProfile({ ...BASE, android: { appId: 'x' } })).toThrow(/android\.appId/)
  })

  it('rejects a block that is not a flat object of strings', () => {
    expect(() => parseBrandProfile({ ...BASE, windows: { assets: { dir: 'x' } } })).toThrow(/windows must be/)
    expect(() => parseBrandProfile({ ...BASE, android: ['x'] })).toThrow(/android must be/)
  })

  it('keeps every platform block out of the deployment environment', () => {
    expect([...NON_ENV_PROFILE_KEYS]).toEqual([...PLATFORMS])
    const acme = JSON.parse(readFileSync(join(process.cwd(), 'brands/acme.brand.json'), 'utf8'))
    // Acme's blocks repeat values its env also sets (the accent, the app ids), so compare
    // environments rather than search for values: the blocks must add nothing at all.
    const withoutBlocks = Object.fromEntries(Object.entries(acme).filter(([key]) => !(PLATFORMS as readonly string[]).includes(key)))
    expect(profileEnv(acme)).toEqual(profileEnv(withoutBlocks as never))
    // And a value only a block carries never appears.
    const env = JSON.stringify(profileEnv({ ...BASE, windows: { identityPublisher: 'CN=only-in-the-block' } }))
    expect(env).not.toContain('only-in-the-block')
  })

  it('acme exercises a block for every platform', () => {
    const acme = parseBrandProfile(JSON.parse(readFileSync(join(process.cwd(), 'brands/acme.brand.json'), 'utf8')))
    for (const platform of PLATFORMS) {
      expect(Object.keys(acme[platform] ?? {}).length, `acme has no ${platform} block`).toBeGreaterThan(0)
    }
  })
})
