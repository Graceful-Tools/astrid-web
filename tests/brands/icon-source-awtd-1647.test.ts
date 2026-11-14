/**
 * AWTD-1647 — a brand profile names its SVG master in `assets.iconSource`.
 *
 * astrid-core's `gen-brand` renders every platform's icon set from one SVG, but
 * no profile here named one: `assets.icon` is NEXT_PUBLIC_BRAND_ICON, the PNG
 * web serves at runtime, and it cannot be an SVG without breaking the favicon
 * route. Jon chose a second key over overloading the first: `assets.iconSource`
 * is build-time only, relative to the profile, and never reaches the runtime env.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { parseBrandProfile, profileEnv, type BrandProfile } from '@/lib/brand/profile'

const BRANDS_DIR = join(process.cwd(), 'brands')

const base: BrandProfile = {
  name: 'Acme',
  description: 'A test partner',
  env: { NEXT_PUBLIC_BRAND_NAME: 'Acme' },
}

describe('assets.iconSource (AWTD-1647)', () => {
  it('accepts an .svg path beside the profile and keeps it out of the runtime env', () => {
    const profile = parseBrandProfile({
      ...base,
      assets: { icon: '/icons/acme-1024.png', iconSource: 'acme.icon.svg' },
    })
    expect(profile.assets?.iconSource).toBe('acme.icon.svg')
    const env = profileEnv(profile)
    expect(env).toMatchObject({ NEXT_PUBLIC_BRAND_ICON: '/icons/acme-1024.png' })
    expect(Object.values(env)).not.toContain('acme.icon.svg')
  })

  it('refuses anything that is not a relative .svg path', () => {
    for (const iconSource of [
      'acme.icon.png',
      '/icons/acme.svg',
      '../public/acme.svg',
      'https://cdn.example.com/acme.svg',
      '',
    ]) {
      expect(() => parseBrandProfile({ ...base, assets: { iconSource } }), iconSource).toThrow(
        /assets\.iconSource/,
      )
    }
  })

  it('every profile that names a master ships it, as a square SVG', () => {
    const named: string[] = []
    for (const file of readdirSync(BRANDS_DIR).filter((f) => f.endsWith('.brand.json'))) {
      const profile = parseBrandProfile(JSON.parse(readFileSync(join(BRANDS_DIR, file), 'utf8')), file)
      const master = profile.assets?.iconSource
      if (!master) continue
      named.push(file)
      const path = join(BRANDS_DIR, master)
      expect(existsSync(path), `${file} names ${master}`).toBe(true)
      const svg = readFileSync(path, 'utf8')
      const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
      expect(viewBox, `${master} has a viewBox`).not.toBeNull()
      expect(viewBox![1], `${master} is square`).toBe(viewBox![2])
    }
    // The acceptance line: at least one profile here makes gen-brand's icon set reachable.
    expect(named).toContain('acme.brand.json')
  })
})
