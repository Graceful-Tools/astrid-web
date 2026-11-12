// @vitest-environment node
/**
 * AWTD-1606 — one image, many brands, stage 2.
 *
 * Stage 1 (AWTD-1587) made the image read its brand at start. These pin what proves it
 * and what an operator relies on:
 *
 *   - self-host.yml builds the image with NO brand and mounts acme, so the CI smoke is
 *     the acceptance test: the published image plus a mounted profile serves Acme;
 *   - the container start runs the build's identity check on the profile it applied,
 *     as a warning that never stops the boot;
 *   - the compose file and its .env.example show how to mount a profile.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load(source: string): unknown }

/** Start load-env.mjs the way the image's CMD does, with `env` as the whole environment. */
function startContainer(env: Record<string, string>, profile?: object) {
  const dir = mkdtempSync(join(tmpdir(), 'load-env-1606-'))
  writeFileSync(join(dir, 'brand-env.json'), '{}')
  writeFileSync(join(dir, 'brand-env.json.public'), '{}')
  writeFileSync(join(dir, 'server.mjs'), 'console.log("started")')
  if (profile) writeFileSync(join(dir, 'x.brand.json'), JSON.stringify(profile))
  return spawnSync(process.execPath, [
    join(ROOT, 'deploy/self-host/load-env.mjs'), join(dir, 'brand-env.json'), '--import', join(dir, 'server.mjs'),
  ], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ASTRID_RUNTIME_BRAND: 'true',
      ...(profile ? { BRAND_PROFILE: join(dir, 'x.brand.json') } : {}),
      ...env,
    } as unknown as NodeJS.ProcessEnv,
  })
}

describe('the container start checks brand identity (AWTD-1606)', () => {
  const acme = JSON.parse(read('brands/acme.brand.json'))

  it('AWTD-1606 warns, naming each identity value a mounted profile leaves on Astrid’s, and still starts', () => {
    const run = startContainer({ BRAND_STRICT_IDENTITY: 'true' }, { env: { NEXT_PUBLIC_BRAND_NAME: 'Half' } })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('started')
    expect(run.stderr).toContain('[load-env]')
    expect(run.stderr).toContain('this server ships Astrid')
    expect(run.stderr).toContain('NEXT_PUBLIC_BRAND_SUPPORT_EMAIL')
    expect(run.stderr).not.toContain('NEXT_PUBLIC_BRAND_NAME\n')
    // Build-time advice has no place in a running container's log.
    expect(run.stderr).not.toContain('BRAND_STRICT_IDENTITY')
  })

  it('AWTD-1606 honours BRAND_INHERIT_ASTRID_IDENTITY at start', () => {
    const run = startContainer(
      { BRAND_INHERIT_ASTRID_IDENTITY: 'NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG' },
      { ...acme, env: { ...acme.env, NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG: '' } }
    )
    expect(run.status, run.stderr).toBe(0)
    expect(run.stderr).not.toContain('identity variable')
  })

  it('AWTD-1606 says nothing for a fully rebranded profile, or for Astrid with nothing mounted', () => {
    for (const run of [startContainer({}, acme), startContainer({})]) {
      expect(run.status, run.stderr).toBe(0)
      expect(run.stderr).not.toContain('identity variable')
    }
  })

  it('AWTD-1606 ships the check in the image, where load-env.mjs looks for it', () => {
    expect(read('Dockerfile')).toMatch(
      /COPY --chown=node:node scripts\/lib\/brand-identity-check\.mjs \.\/scripts\/lib\/brand-identity-check\.mjs/
    )
  })
})

describe('self-host.yml proves a mounted brand on an unbranded image (AWTD-1606)', () => {
  const source = read('.github/workflows/self-host.yml')
  const workflow = yaml.load(source) as {
    on: { pull_request: { paths: string[] } }
    jobs: { image: { steps: Array<{ name: string; run?: string }> } }
  }
  const steps = workflow.jobs.image.steps
  const step = (name: string) => steps.find((s) => s.name === name)?.run ?? ''

  it('AWTD-1606 builds with no BRAND and mounts acme through BRAND_PROFILE and BRAND_ASSETS_DIR', () => {
    const settings = step("Write the stack's settings")
    expect(settings).not.toMatch(/BRAND=\w/)
    expect(settings).toContain('BRAND_PROFILE=/brand/acme.brand.json')
    expect(settings).toContain('BRAND_ASSETS_DIR=/brand/assets')
    const mount = step('Mount the Acme profile')
    expect(mount).toContain('brands/acme.brand.json')
    expect(mount).toContain('./brand:/brand:ro')
    // Every compose call sees the mount, or the stack it tears down is not the one it built.
    const compose = [...source.matchAll(/docker compose [^\n]*/g)].map((m) => m[0])
    expect(compose.length).toBeGreaterThan(3)
    for (const call of compose) expect(call).toContain('-f deploy/self-host/brand.override.yml')
  })

  it('AWTD-1606 smoke-tests the brand and the start-time identity check', () => {
    expect(step('Smoke test')).toContain('SMOKE_BRAND_PROFILE=deploy/self-host/brand/acme.brand.json')
    expect(step('Smoke test')).toContain('SMOKE_BRAND_ASSETS_DIR=deploy/self-host/brand/assets')
    expect(step('The container start left no Astrid identity')).toContain('identity variable')
  })

  it.each([
    'scripts/lib/brand-identity-check.mjs',
    'brands/acme.brand.json',
    'lib/brand/runtime-env.ts',
    'app/brand-assets/[...path]/route.ts',
    'app/brand-icon/[file]/route.ts',
    'app/manifest.json/route.ts',
    'scripts/self-host-smoke.ts',
  ])('AWTD-1606 a PR touching only %s runs the smoke', async (file) => {
    const { matchesGlob } = await import('node:path')
    expect(workflow.on.pull_request.paths.some((glob) => matchesGlob(file, glob)), file).toBe(true)
  })

  it('AWTD-1606 keeps an operator’s mounted brand out of the build context', () => {
    expect(read('.dockerignore')).toMatch(/^deploy\/self-host\/brand$/m)
  })
})

describe('the compose stack shows how to mount a brand (AWTD-1606)', () => {
  it('AWTD-1606 carries the brand volume commented out under the app service', () => {
    const compose = read('deploy/self-host/docker-compose.yml')
    const app = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  cron:'))
    expect(app).toMatch(/^\s+# - \.\/brand:\/brand:ro$/m)
  })

  it('AWTD-1606 documents BRAND_PROFILE in .env.example, and no longer says NEXT_PUBLIC_* is ignored', () => {
    const example = read('deploy/self-host/.env.example')
    expect(example).toMatch(/^# BRAND_PROFILE=\/brand\/acme\.brand\.json$/m)
    expect(example).toMatch(/^# BRAND_ASSETS_DIR=\/brand\/assets$/m)
    expect(example).not.toMatch(/set here at runtime it is ignored/)
  })

  it('AWTD-1606 release-image.yml no longer says one image is one brand', () => {
    expect(read('.github/workflows/release-image.yml')).not.toMatch(/One image is one brand/i)
  })
})
