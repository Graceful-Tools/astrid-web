/**
 * AWTD-1648: acme is the profile that "exercises every axis of the whitelabel
 * configuration", and astrid-core's `cargo xtask gen-brand` reads each platform
 * block in the client's own spelling (core `11ea272`). So acme carries every
 * identity field those readers take, and a field it leaves out is a field no
 * profile in this repo exercises.
 *
 * `windows.assets` is the one left out on purpose: it names a tile directory
 * beside the profile, there is no Acme tile artwork, and core falls back to
 * Astrid's tiles without it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseBrandProfile, profileEnv } from '@/lib/brand/profile'

const acme = parseBrandProfile(
  JSON.parse(readFileSync(join(process.cwd(), 'brands', 'acme.brand.json'), 'utf8')),
  'acme.brand.json',
)

const REQUIRED: Record<'ios' | 'android' | 'windows' | 'vscode' | 'code', string[]> = {
  ios: ['bundleId', 'appGroup', 'keychainGroup', 'developmentTeam', 'displayName'],
  android: ['applicationId', 'appName'],
  windows: ['identityName', 'identityPublisher', 'publisherDisplayName'],
  vscode: ['publisher', 'displayName'],
  code: ['bundleId', 'applicationName', 'nameShort', 'nameLong'],
}

describe('acme carries every platform identity field (AWTD-1648)', () => {
  for (const [platform, keys] of Object.entries(REQUIRED)) {
    it(`AWTD-1648: ${platform} block has ${keys.join(', ')}`, () => {
      const block = acme[platform as keyof typeof REQUIRED] ?? {}
      expect(keys.filter(key => !block[key]?.trim())).toEqual([])
    })
  }

  it('AWTD-1648: none of the platform identities reaches the web deployment environment', () => {
    const values = Object.values(profileEnv(acme))
    expect(values).not.toContain(acme.code?.bundleId)
    expect(values).not.toContain(acme.windows?.identityName)
  })
})
