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
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
