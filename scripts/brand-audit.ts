#!/usr/bin/env npx tsx
/**
 * Brand audit — run the unit suite as a NON-Astrid deployment (task bc27c00a).
 *
 * The web equivalent of the iOS BrandAuditTests. tests/brands/brand-matrix.test.ts
 * checks the brand PROFILES resolve correctly; it cannot catch a test — or the
 * code under it — that quietly assumes astrid.cc is the ground truth. Dozens do.
 *
 * This applies the acme profile's environment to the whole suite and reports
 * which files stop passing. Every one is either:
 *   - a test asserting Astrid's values where it should assert the profile's, or
 *   - real code that ignores the brand configuration.
 *
 * Both are worth seeing. NON-BLOCKING by default: the backlog predates the
 * audit, and a gate that fails on arrival gets skipped rather than read. Pass
 * --strict once the list is empty, and wire it into predeploy then.
 */

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { profileEnv } from '../lib/brand/profile'

const PROFILE = process.argv.includes('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : 'acme'
const strict = process.argv.includes('--strict')

function main() {
  const profile = JSON.parse(
    readFileSync(join(process.cwd(), 'brands', `${PROFILE}.brand.json`), 'utf8')
  )

  console.log(`\n🎭 brand audit — running the unit suite as "${profile.name}"\n`)

  // profileEnv, not profile.env — the same call the deploy script and the brand
  // matrix make, so the audit cannot test a configuration that never ships.
  const env = { ...process.env, ...profileEnv(profile) }

  let output = ''
  let failed = false
  try {
    output = execFileSync('npx', ['vitest', 'run'], {
      encoding: 'utf8',
      env,
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    failed = true
    const err = error as { stdout?: string; stderr?: string }
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }

  const failingFiles = [
    ...new Set(
      output
        .split('\n')
        .map((line) => /(?:FAIL|❯)\s+(\S+\.test\.tsx?)/.exec(line)?.[1])
        .filter((f): f is string => Boolean(f))
    ),
  ].sort()

  if (!failed) {
    console.log(`✅ The whole suite passes as ${profile.name}. Nothing assumes Astrid.\n`)
    process.exit(0)
  }

  // A non-zero exit with no parsed test files means vitest itself did not run —
  // a bad reporter flag did exactly this and the audit cheerfully printed
  // "0 test file(s) do not pass", which is the green-for-the-wrong-reason
  // failure this whole task is about. Fail loudly instead.
  if (failingFiles.length === 0) {
    console.error('❌ vitest exited non-zero but reported no failing test files.')
    console.error('   The runner itself failed — this is NOT a passing audit.\n')
    console.error(output.split('\n').slice(-40).join('\n'))
    process.exit(1)
  }

  console.log(`📋 ${failingFiles.length} test file(s) do not pass as ${profile.name}:\n`)
  for (const file of failingFiles) console.log(`   ${file}`)
  console.log(
    '\n   Each is either a test asserting Astrid values where it should assert the\n' +
      "   profile's, or real code ignoring the brand configuration.\n"
  )

  process.exit(strict ? 1 : 0)
}

main()
