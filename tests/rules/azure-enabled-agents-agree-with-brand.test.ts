/**
 * ADEV-192: the Azure parameters file sets BRAND_ENABLED_AGENTS, and the environment
 * beats the brand profile, so a stale value there silently undoes the profile
 * (ADEV-97 enabled copilot; the bicepparam kept 'claude' and Copilot answered 409).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const list = (s: string | undefined) => (s ?? '').split(',').map(a => a.trim()).sort()

describe('ADEV-192 Azure BRAND_ENABLED_AGENTS', () => {
  it('equals the whitelabel-partner brand profile', () => {
    const azure = /BRAND_ENABLED_AGENTS:\s*'([^']*)'/.exec(read('deploy/azure/whitelabel-partner.bicepparam'))?.[1]
    const brand = JSON.parse(read('brands/whitelabel-partner.brand.json'))
    expect(list(azure)).toEqual(list(brand.env.BRAND_ENABLED_AGENTS))
  })
})
