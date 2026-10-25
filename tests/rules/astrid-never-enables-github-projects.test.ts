/**
 * RULE — decision D5 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md (§8.3):
 * GitHub Projects is never on astrid.cc. Before AWTD-1151 that was a
 * convention; this makes it a failing build.
 *
 *   - the capability is OFF unless a deployment sets it, unlike every other
 *     capability (which default on);
 *   - Astrid's brand profile never sets it, and its matrix expects it off.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const astrid = JSON.parse(readFileSync(join(process.cwd(), 'brands/astrid.brand.json'), 'utf8'))

describe('GitHub Projects is never on Astrid (D5, AWTD-1151)', () => {
  const original = process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS
    else process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = original
    vi.resetModules()
  })

  it("Astrid's profile does not set NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS", () => {
    expect(Object.keys(astrid.env ?? {})).not.toContain('NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS')
    expect(astrid.expect.capabilities.githubProjects).toBe(false)
  })

  it.each([undefined, '', 'false', 'off', 'maybe'])('is off when the switch is %j', async value => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS
    else process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = value
    vi.resetModules()
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')
    expect(CAPABILITIES.githubProjects).toBe(false)
  })

  it.each(['true', '1', 'on', 'yes'])('is on only when a brand says %j', async value => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = value
    vi.resetModules()
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')
    expect(CAPABILITIES.githubProjects).toBe(true)
  })
})
