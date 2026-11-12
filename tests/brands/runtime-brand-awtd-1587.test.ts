// @vitest-environment node
/**
 * AWTD-1587 — one image, many brands.
 *
 * Every brand value was a build-time constant, so each brand was its own image build and
 * the published image could only be Astrid. These pin the runtime path, for every
 * committed profile:
 *
 *   - the server resolves BRAND from the environment it is RUNNING with;
 *   - the browser resolves it from what the server wrote into the page, even when the
 *     bundle was built with no brand at all;
 *   - a profile mounted with BRAND_PROFILE becomes the same environment `profileEnv()`
 *     gives a built one;
 *   - artwork comes from a mounted BRAND_ASSETS_DIR.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profileEnv, type BrandProfile } from '@/lib/brand/profile'
// @ts-expect-error -- plain .mjs shipped in the runtime image, no type declarations
import { brandProfileEnv } from '@/deploy/self-host/brand-profile-env.mjs'

const BRANDS_DIR = join(process.cwd(), 'brands')
const PROFILES: Array<[string, BrandProfile & { expect: Record<string, unknown> }]> = readdirSync(BRANDS_DIR)
  .filter((f) => f.endsWith('.brand.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(BRANDS_DIR, f), 'utf8'))])

const ORIGINAL_ENV = { ...process.env }

function clearBrandEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_BRAND_') || key.startsWith('BRAND_')) delete process.env[key]
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('a mounted profile is applied exactly as a built one (AWTD-1587)', () => {
  it.each(PROFILES)('%s', (_file, profile) => {
    expect(brandProfileEnv(profile)).toEqual(profileEnv(profile))
  })

  it('refuses something that is not a brand profile', () => {
    expect(() => brandProfileEnv({ name: 'x' })).toThrow(/env/)
    expect(() => brandProfileEnv({ env: { DATABASE_URL: 'postgres://x' } })).toThrow(/not a brand variable/)
  })
})

describe('container start applies BRAND_PROFILE (AWTD-1587)', () => {
  it('environment beats the mounted profile, which beats the built one, with no warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-env-'))
    writeFileSync(join(dir, 'brand-env.json'), JSON.stringify({ NEXT_PUBLIC_BRAND_NAME: 'Built', NEXT_PUBLIC_BRAND_SLOGAN: 'built' }))
    writeFileSync(join(dir, 'brand-env.json.public'), '{}')
    writeFileSync(join(dir, 'acme.brand.json'), readFileSync(join(BRANDS_DIR, 'acme.brand.json')))
    writeFileSync(join(dir, 'server.mjs'), `console.log(JSON.stringify({
      name: process.env.NEXT_PUBLIC_BRAND_NAME, domain: process.env.NEXT_PUBLIC_BRAND_DOMAIN,
      slogan: process.env.NEXT_PUBLIC_BRAND_SLOGAN, icon: process.env.NEXT_PUBLIC_BRAND_ICON }))`)
    const run = spawnSync(process.execPath, [
      join(process.cwd(), 'deploy/self-host/load-env.mjs'), join(dir, 'brand-env.json'), '--import', join(dir, 'server.mjs'),
    ], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        ASTRID_RUNTIME_BRAND: 'true',
        BRAND_PROFILE: join(dir, 'acme.brand.json'),
        NEXT_PUBLIC_BRAND_DOMAIN: 'operator.example',
      },
    })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stderr).not.toContain('compiled in at build')
    expect(JSON.parse(run.stdout.trim())).toEqual({
      name: 'Acme', // the mounted profile beats the built one
      domain: 'operator.example', // the environment beats both
      slogan: 'Work, handled.',
      icon: '/icons/acme-1024.png', // assets.icon, mapped as profileEnv maps it
    })
  })
})

describe.each(PROFILES)('runtime brand: %s', (_file, profile) => {
  beforeEach(() => {
    clearBrandEnv()
    vi.resetModules()
  })

  it('the server reads the brand from the environment it runs with', async () => {
    Object.assign(process.env, profileEnv(profile))
    const { BRAND } = await import('@/lib/brand/config')
    expect(BRAND.appName).toBe(profile.expect.appName)
    expect(BRAND.domain).toBe(profile.expect.domain)
  })

  it('the browser reads the brand the server wrote into the page, not the build’s', async () => {
    // What the root layout serialises on the server…
    Object.assign(process.env, profileEnv(profile))
    const { clientBrandEnv, scriptSafeJson } = await import('@/lib/brand/client-env')
    const written = JSON.parse(scriptSafeJson(clientBrandEnv()))
    // …only public values ever reach the page.
    expect(Object.keys(written).every((key) => key.startsWith('NEXT_PUBLIC_BRAND_'))).toBe(true)

    // …and a browser whose bundle was built with NO brand environment at all.
    clearBrandEnv()
    vi.resetModules()
    vi.stubGlobal('window', { __ASTRID_BRAND_ENV__: written })
    const { BRAND } = await import('@/lib/brand/config')
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')
    expect(BRAND.appName).toBe(profile.expect.appName)
    expect(BRAND.accentColor).toBe(profile.expect.accentColor)
    expect(BRAND.appStoreUrl).toBe(profile.expect.appStoreUrl)
    for (const [key, expected] of Object.entries(profile.expect.capabilities as Record<string, boolean>)) {
      expect(CAPABILITIES[key as keyof typeof CAPABILITIES], key).toBe(expected)
    }
  })
})

describe('the page carries the brand only in a runtime-brand build (AWTD-1587)', () => {
  it('escapes the values so a profile cannot close the script tag', async () => {
    const { scriptSafeJson } = await import('@/lib/brand/client-env')
    const json = scriptSafeJson({ NEXT_PUBLIC_BRAND_NAME: '</script><script>alert(1)</script>' })
    expect(json).not.toContain('</script>')
    expect(JSON.parse(json).NEXT_PUBLIC_BRAND_NAME).toBe('</script><script>alert(1)</script>')
  })

  it('is off unless the image says so, so hosted Astrid keeps static pages', async () => {
    delete process.env.ASTRID_RUNTIME_BRAND
    const { isRuntimeBrandBuild } = await import('@/lib/brand/runtime-env')
    expect(isRuntimeBrandBuild()).toBe(false)
    process.env.ASTRID_RUNTIME_BRAND = 'true'
    expect(isRuntimeBrandBuild()).toBe(true)
  })

  it('the layout writes the script and renders per request only when it is on', () => {
    const layout = readFileSync(join(process.cwd(), 'app/[locale]/layout.tsx'), 'utf8')
    expect(layout).toMatch(/if \(runtimeBrand\) await connection\(\)/)
    expect(layout).toMatch(/\{runtimeBrand && <BrandEnvScript \/>\}/)
  })

  it('the Docker image is built and started as a runtime-brand image', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8')
    expect(dockerfile.match(/ASTRID_RUNTIME_BRAND=true/g)?.length).toBeGreaterThanOrEqual(2)
    expect(dockerfile).toContain('brand-profile-env.mjs')
  })
})

describe('artwork from a mounted directory (AWTD-1587)', () => {
  it('serves /brand-assets/* from BRAND_ASSETS_DIR and nothing outside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brand-assets-'))
    const png = readFileSync(join(process.cwd(), 'public/icons/acme-1024.png'))
    writeFileSync(join(dir, 'partner-1024.png'), png)
    process.env.BRAND_ASSETS_DIR = dir
    const { GET } = await import('@/app/brand-assets/[...path]/route')
    const get = (path: string[]) => GET(new Request('https://x/'), { params: Promise.resolve({ path }) })

    const ok = await get(['partner-1024.png'])
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await ok.arrayBuffer()).equals(png)).toBe(true)

    expect((await get(['..', '..', 'etc', 'passwd.png'])).status).toBe(404)
    expect((await get(['notes.txt'])).status).toBe(404)
    delete process.env.BRAND_ASSETS_DIR
    vi.resetModules()
    const { GET: unset } = await import('@/app/brand-assets/[...path]/route')
    expect((await unset(new Request('https://x/'), { params: Promise.resolve({ path: ['partner-1024.png'] }) })).status).toBe(404)
  })

  it('generates every icon size from a mounted source icon', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brand-assets-'))
    writeFileSync(join(dir, 'partner-1024.png'), readFileSync(join(process.cwd(), 'public/icons/acme-1024.png')))
    clearBrandEnv()
    process.env.BRAND_ASSETS_DIR = dir
    process.env.NEXT_PUBLIC_BRAND_ICON = '/brand-assets/partner-1024.png'
    const { GET } = await import('@/app/brand-icon/[file]/route')
    const res = await GET(new Request('https://x/'), { params: Promise.resolve({ file: 'icon-192.png' }) })
    expect(res.status).toBe(200)
    const { default: sharp } = await import('sharp')
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([192, 192])
  })
})
