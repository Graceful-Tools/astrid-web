#!/usr/bin/env npx tsx
/**
 * Environment drift gate (task 0c387855).
 *
 * Three sources have to agree about which variables exist:
 *
 *   1. lib/env.ts       — the registry, with a scope and a description
 *   2. .env.example     — what an operator is told to set
 *   3. the source itself — what `process.env` is actually read for
 *
 * They did not. 150 variables were read, 88 were documented, and nothing
 * compared the two — which is how GITHUB_SYNC_CLIENT_SECRET,
 * MAILGUN_WEBHOOK_SIGNING_KEY and a dozen other secrets ended up undocumented,
 * and how CRON_SECRET stayed out of the production validator while every cron
 * route failed closed on it for months (task a5eb65a4).
 *
 * Drift is reported in BOTH directions: a variable read but not registered, a
 * registered variable missing from .env.example, and a documented variable
 * nothing reads. The last one matters as much as the first — a partner setting
 * a dead variable believes they have configured something.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ENV_BY_NAME, ENV_VARS, documentedVars } from '../lib/env'

const ROOT = process.cwd()

/** Directories that are not this app's source. */
const SKIP = new Set(['node_modules', '.next', '.git', 'archived', 'dist', '.vercel', 'coverage'])

/** Read but deliberately unregistered: dynamic lookups the scanner cannot resolve. */
const IGNORED_READS = new Set([
  // `process.env[`NEXT_PUBLIC_${key}`]` style construction in a template.
  'NEXT_PUBLIC_',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

function readsInSource(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of walk(ROOT)) {
    const rel = file.replace(`${ROOT}/`, '')
    // tests/ may reference anything while arranging a fixture.
    if (rel.startsWith('tests/')) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!found.has(m[1])) found.set(m[1], rel)
    }
    for (const m of src.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
      if (!found.has(m[1])) found.set(m[1], rel)
    }
  }
  return found
}

function namesInEnvExample(): Set<string> {
  const names = new Set<string>()
  for (const line of readFileSync(join(ROOT, '.env.example'), 'utf8').split('\n')) {
    const m = /^#?\s*([A-Z0-9_]+)=/.exec(line.trim())
    if (m) names.add(m[1])
  }
  return names
}

function main() {
  const reads = readsInSource()
  const documented = namesInEnvExample()
  const problems: string[] = []

  console.log('\n🔑 check:env — registry / .env.example / source agreement\n')

  // 1. Read in source, absent from the registry.
  const unregistered = [...reads.keys()]
    .filter((name) => !ENV_BY_NAME.has(name) && !IGNORED_READS.has(name))
    .sort()
  if (unregistered.length) {
    problems.push(
      `${unregistered.length} variable(s) read in source but not in lib/env.ts:\n` +
        unregistered.map((n) => `     - ${n}  (${reads.get(n)})`).join('\n') +
        '\n     Add an entry with a scope and a one-line description.'
    )
  }

  // 2. Registered as operator-authored, absent from .env.example.
  const undocumented = documentedVars()
    .filter((v) => !documented.has(v.name))
    .map((v) => v.name)
    .sort()
  if (undocumented.length) {
    problems.push(
      `${undocumented.length} required/optional variable(s) missing from .env.example:\n` +
        undocumented.map((n) => `     - ${n}`).join('\n')
    )
  }

  // 3. In .env.example but nothing reads it — a partner configuring nothing.
  //
  // Only operator-facing variables. A tooling variable is often referenced by
  // NAME from a list (scripts/test-astrid-models.ts maps 'gemini' ->
  // 'GEMINI_API_KEY') rather than as a direct property read, which this scanner
  // cannot see; failing on those would train people to ignore the gate.
  const operatorFacing = new Set(documentedVars().map((v) => v.name))
  const dead = [...documented]
    .filter((name) => operatorFacing.has(name) && !reads.has(name))
    .filter((name) => !ENV_BY_NAME.get(name)?.readExternally)
    .sort()
  if (dead.length) {
    problems.push(
      `${dead.length} variable(s) in .env.example that no source file reads:\n` +
        dead.map((n) => `     - ${n}`).join('\n') +
        '\n     Remove them, or the deployment guide is describing a switch that does nothing.'
    )
  }

  // 4. PLATFORM variables must not be in .env.example. Tooling ones may be:
  // this file doubles as the local-developer setup guide, and a developer does
  // need VERCEL_TOKEN and GITHUB_TOKEN. But nobody should ever be told to set
  // VERCEL_URL or NODE_ENV by hand — the host supplies those, and a stale value
  // in .env.local silently overrides reality.
  const platformDocumented = ENV_VARS.filter(
    (v) => v.scope === 'platform' && documented.has(v.name)
  ).map((v) => v.name)
  if (platformDocumented.length) {
    problems.push(
      `${platformDocumented.length} host-injected variable(s) in .env.example:\n` +
        platformDocumented.map((n) => `     - ${n}`).join('\n') +
        '\n     The host sets these. A hand-set value silently overrides reality.'
    )
  }

  console.log(
    `   registry: ${ENV_VARS.length}   .env.example: ${documented.size}   read in source: ${reads.size}\n`
  )

  if (problems.length === 0) {
    console.log('✅ Registry, .env.example and source agree.\n')
    process.exit(0)
  }

  for (const p of problems) console.log(`❌ ${p}\n`)
  console.error('❌ Environment drift. lib/env.ts is the source of truth.\n')
  process.exit(1)
}

main()
