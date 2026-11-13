#!/usr/bin/env node
/**
 * Apply a brand's environment, then build or start the app (AWTD-1286).
 *
 *   node load-env.mjs brand-env.json --exec npm run build   # at image build
 *   node load-env.mjs brand-env.json --import ./server.js   # at container start
 *
 * The file is scripts/brand-env-file.ts's output. A variable already set in
 * the environment wins, so an operator can override any brand value at
 * runtime without rebuilding — except NEXT_PUBLIC_* values, which were
 * compiled into the bundle. The build records those in `<file>.public`, and
 * the start warns about any the runtime environment contradicts, because an
 * ignored setting that looks applied is the worst kind of misconfiguration.
 *
 * One image, many brands (AWTD-1587): an image built with ASTRID_RUNTIME_BRAND=true (the
 * published one) reads every brand value at runtime, NEXT_PUBLIC_* included, so there
 * is nothing to warn about. `BRAND_PROFILE=/path/to/x.brand.json` then applies a mounted
 * profile at start. Precedence: a variable set in the environment, then the mounted
 * profile, then the profile the image was built with.
 *
 * The build's brand identity check (scripts/lib/brand-identity-check.mjs, AWTD-1285) never
 * sees a mounted profile, so the start runs it again on what it applied (AWTD-1606): a
 * warning naming each identity value still left on Astrid's, never a refusal to boot.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brandProfileEnv } from './brand-profile-env.mjs'

const [file, mode, ...rest] = process.argv.slice(2)
const publicFile = `${resolve(file)}.public`
const isPublic = name => name.startsWith('NEXT_PUBLIC_')
const runtimeBrand = process.env.ASTRID_RUNTIME_BRAND?.trim().toLowerCase() === 'true'

if (mode === '--import' && !runtimeBrand) {
  // Compare before applying: what the operator set, against what was compiled in.
  const built = existsSync(publicFile) ? JSON.parse(readFileSync(publicFile, 'utf8')) : {}
  for (const [name, value] of Object.entries(process.env)) {
    if (isPublic(name) && (built[name] ?? '') !== value) {
      console.warn(
        `[load-env] ${name} is compiled in at build, so the runtime value is ignored. ` +
        'Put it in the brand profile (or the build arguments) and rebuild the image.'
      )
    }
  }
}

const mounted = mode === '--import' && process.env.BRAND_PROFILE?.trim()
  ? brandProfileEnv(JSON.parse(readFileSync(resolve(process.env.BRAND_PROFILE.trim()), 'utf8')), process.env.BRAND_PROFILE)
  : {}
const values = { ...JSON.parse(readFileSync(resolve(file), 'utf8')), ...mounted }
for (const [name, value] of Object.entries(values)) {
  if (process.env[name] === undefined) process.env[name] = String(value)
}

if (mode === '--import') await checkIdentityAtStart()
if (mode === '--import' && runtimeBrand) await deriveBrandColorsAtStart()

/**
 * A runtime-brand image builds with one accent and may start with another, so the hover and
 * inks next.config.mjs derived at build can be the wrong brand's. Derive them again from what
 * was applied, with astrid-core's rule (scripts/lib/brand-colors.mjs, AWTD-1589). Best effort,
 * like the identity check: a refused accent or a missing core build is a warning, never a
 * refusal to boot, and the stylesheets then keep their own values.
 */
async function deriveBrandColorsAtStart() {
  const here = dirname(fileURLToPath(import.meta.url))
  const find = candidates => candidates.map(candidate => join(here, candidate)).find(existsSync)
  const helper = find(['scripts/lib/brand-colors.mjs', '../../scripts/lib/brand-colors.mjs'])
  const packageDir = find(['packages/astrid-rules', '../../packages/astrid-rules'])
  if (!helper || !packageDir) return
  try {
    const { derivedBrandColorEnv } = await import(pathToFileURL(helper).href)
    for (const [name, value] of Object.entries(derivedBrandColorEnv(process.env, packageDir))) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  } catch (error) {
    console.warn(`[load-env] the brand's hover and ink colours were not derived: ${error.message}`)
  }
}

/**
 * The identity check, from scripts/lib/ beside this file in the image, or two levels up in
 * a checkout (the Dockerfile copies it to the first; tests run this from the second).
 */
async function checkIdentityAtStart() {
  const here = dirname(fileURLToPath(import.meta.url))
  const checker = ['scripts/lib/brand-identity-check.mjs', '../../scripts/lib/brand-identity-check.mjs']
    .map(candidate => join(here, candidate))
    .find(existsSync)
  if (!checker) return
  const { checkBrandIdentity } = await import(pathToFileURL(checker).href)
  checkBrandIdentity(process.env, { acknowledged: process.env.BRAND_INHERIT_ASTRID_IDENTITY, atStart: true })
}

if (mode === '--exec' && rest.length > 0) {
  const compiled = Object.fromEntries(Object.entries(process.env).filter(([name]) => isPublic(name)))
  writeFileSync(publicFile, `${JSON.stringify(compiled, null, 2)}\n`)
  const result = spawnSync(rest[0], rest.slice(1), { stdio: 'inherit', env: process.env })
  process.exit(result.status ?? 1)
} else if (mode === '--import' && rest.length === 1) {
  await import(pathToFileURL(resolve(rest[0])).href)
} else {
  console.error('usage: load-env.mjs <env.json> (--exec <command…> | --import <module>)')
  process.exit(2)
}
