/**
 * AWTD-1589 step 3: a partner's hover and inks are astrid-core's, byte for byte.
 *
 * Web used to derive them itself (the accent darkened 15% for the hover, inks stepped against
 * web's own cards), and iOS read a hover it was never given and fell back to Astrid's blue — so
 * Acme's purple had a blue hover on one client and a web-made one on another. astrid-core's
 * `brandColors` rule (AWTD2-159) is now the one derivation: next.config.mjs runs it at build
 * through the vendored wasm (scripts/lib/brand-colors.mjs) and the layout paints its answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import { hexToRgbTriplet } from '@/lib/brand/colors'
import { parseBrandProfile, profileEnv } from '@/lib/brand/profile'
import { DERIVED_BRAND_COLOR_ENV, derivedBrandColorEnv } from '@/scripts/lib/brand-colors.mjs'

const ROOT = process.cwd()
const ORIGINAL_ENV = { ...process.env }
const DERIVED_KEYS = Object.keys(DERIVED_BRAND_COLOR_ENV)

/** core's answer, asked directly through the rules door rather than through the helper. */
function core(accent: string) {
  const rules = loadCoreRulesFrom(join(ROOT, 'packages', 'astrid-rules'))
  return JSON.parse(rules.runJson(JSON.stringify({ kind: 'brandColors', accent })))
}

function acmeEnv(): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(ROOT, 'brands', 'acme.brand.json'), 'utf8'))
  return profileEnv(parseBrandProfile(raw, 'acme.brand.json'))
}

beforeEach(() => {
  vi.resetModules()
  for (const key of DERIVED_KEYS) delete process.env[key]
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe("a partner's hover and inks come from astrid-core (AWTD-1589)", () => {
  it("paints acme's hover and inks exactly as core derives them", async () => {
    const env = acmeEnv()
    // What next.config.mjs does at build.
    Object.assign(process.env, env, derivedBrandColorEnv(env))
    const { brandAccentCssVars } = await import('@/lib/brand/css-vars')

    const answer = core(env.NEXT_PUBLIC_BRAND_ACCENT_COLOR)
    expect(answer.ok).toBe(true)
    expect(brandAccentCssVars()).toEqual({
      '--brand-accent': '#7e22ce',
      '--brand-accent-rgb': hexToRgbTriplet(answer.value.accent),
      '--brand-accent-hover-rgb': hexToRgbTriplet(answer.value.accentHover),
      '--brand-accent-ink-rgb': hexToRgbTriplet(answer.value.accentInk),
      '--brand-accent-ink-dark-rgb': hexToRgbTriplet(answer.value.accentInkDark),
    })
    // Pinned too, so a change in core's rule shows up here as a diff rather than passing
    // silently: the values core's own test and gen-brand give for #7E22CE.
    expect(answer.value).toMatchObject({
      accent: '#7E22CE',
      accentHover: '#6B1DAF',
      accentInk: '#7E22CE',
      accentInkDark: '#BF91E7',
    })
  })

  it('every committed partner accent is one core accepts, so no brand build fails on it', () => {
    for (const file of ['acme.brand.json', 'whitelabel.brand.json', 'whitelabel-partner.brand.json', 'github-projects.brand.json']) {
      const raw = JSON.parse(readFileSync(join(ROOT, 'brands', file), 'utf8'))
      const env = profileEnv(parseBrandProfile(raw, file))
      expect(() => derivedBrandColorEnv(env), file).not.toThrow()
    }
  })

  it("fails a build whose accent cannot carry a label, with core's reason", () => {
    let error: (Error & { refused?: boolean }) | undefined
    try {
      derivedBrandColorEnv({ NEXT_PUBLIC_BRAND_ACCENT_COLOR: '#a855f7' })
    } catch (caught) {
      error = caught as Error & { refused?: boolean }
    }
    expect(error?.refused).toBe(true)
    expect(error?.message).toMatch(/3\.96:1/)
  })

  it('derives nothing when no accent is set (Astrid keeps its designed values)', () => {
    expect(derivedBrandColorEnv({})).toEqual({})
  })

  it('keeps a value the deployment states, as gen-brand does', () => {
    const derived = derivedBrandColorEnv({
      NEXT_PUBLIC_BRAND_ACCENT_COLOR: '#7e22ce',
      NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR: '#000000',
    })
    expect(derived.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR).toBe('#000000')
    expect(derived.NEXT_PUBLIC_BRAND_ACCENT_INK_COLOR).toBe('#7E22CE')
  })

  it('publishes no partner triplets at all when nothing was derived, rather than half a set', async () => {
    process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR = '#7e22ce'
    const { brandAccentCssVars } = await import('@/lib/brand/css-vars')
    expect(brandAccentCssVars()).toEqual({ '--brand-accent': '#7e22ce' })
  })

  it('accepts a stated hover in a profile, as the native apps already read it, and keeps it', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'brands', 'acme.brand.json'), 'utf8'))
    const env = profileEnv(parseBrandProfile({ ...raw, env: { ...raw.env, NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR: '#4c1d95' } }))
    expect(derivedBrandColorEnv(env).NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR).toBe('#4c1d95')
  })

  it('runs at build in next.config.mjs', () => {
    const config = readFileSync(join(ROOT, 'next.config.mjs'), 'utf8')
    expect(config).toContain("from './scripts/lib/brand-colors.mjs'")
    expect(config).toMatch(/env:\s*\{[^}]*\.\.\.brandColorEnv\(\)/)
  })

  it('derives them again at container start for a runtime-brand image, from the mounted profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-env-1589-'))
    writeFileSync(join(dir, 'brand-env.json'), '{}')
    writeFileSync(join(dir, 'brand-env.json.public'), '{}')
    // The server prints what it was started with, as the app's brandEnv would read it.
    writeFileSync(
      join(dir, 'server.mjs'),
      `console.log(JSON.stringify(${JSON.stringify(DERIVED_KEYS)}.map((key) => process.env[key] ?? null)))`,
    )
    const start = (accent: string) => {
      writeFileSync(join(dir, 'x.brand.json'), JSON.stringify({ name: 'X', env: { NEXT_PUBLIC_BRAND_ACCENT_COLOR: accent } }))
      return spawnSync(process.execPath, [
        join(ROOT, 'deploy/self-host/load-env.mjs'), join(dir, 'brand-env.json'), '--import', join(dir, 'server.mjs'),
      ], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ASTRID_RUNTIME_BRAND: 'true', BRAND_PROFILE: join(dir, 'x.brand.json') } as unknown as NodeJS.ProcessEnv,
      })
    }

    const run = start('#7e22ce')
    expect(run.status, run.stderr).toBe(0)
    expect(JSON.parse(run.stdout.trim().split('\n').pop()!)).toEqual(['#6B1DAF', '#7E22CE', '#BF91E7'])

    // A refused accent warns and still boots: the stylesheets keep their own values.
    const refused = start('#a855f7')
    expect(refused.status, refused.stderr).toBe(0)
    expect(refused.stderr).toMatch(/hover and ink colours were not derived: .*3\.96:1/)
    expect(JSON.parse(refused.stdout.trim().split('\n').pop()!)).toEqual([null, null, null])
  })
})
