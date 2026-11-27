#!/usr/bin/env node
/**
 * ADEV-339: the Socket gate (scripts/lib/socket-package-gate.mjs). `check` covers npm, Rust
 * (Cargo.lock), Gradle version catalogs and NuGet (.csproj), in this repo or any repo it is run
 * from (the other app repos call .github/workflows/socket-gate-reusable.yml); `add` is npm's.
 *
 *   npm run deps:add -- <name>[@version] [...] [--save-dev]
 *     Resolve into package.json and package-lock.json only (nothing downloaded to node_modules,
 *     no install scripts), ask Socket about every package version that would be new, transitive
 *     ones included, and run `npm ci` only if all pass. A refusal restores both files.
 *
 *   npm run deps:check -- [--base <git ref>]
 *     The same gate over the difference between <ref>'s package files and the working tree's:
 *     package-lock.json, Cargo.lock, libs.versions.toml and *.csproj, wherever they are tracked.
 *     From another repo: node ../astrid-web/scripts/deps-gate.mjs check (run in that repo).
 *     The PR check (security-gates.yml) runs this before `npm ci`. Default base: origin/main.
 *
 * Exit codes: 0 pass, 1 refused, 3 could not ask or trust the answer (also a refusal).
 * Plain Node, no dependencies: it must run before anything is installed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { GATED_FILES, addedPackages, checkPackages, formatReport, packageKey, packagesForFile, specProblem } from './lib/socket-package-gate.mjs'

const EXIT_REFUSED = 1
const EXIT_UNKNOWN = 3

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
}

function packagesAt(ref, path) {
  let text
  try {
    text = git(['show', `${ref}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return new Map() // the file is new at this ref: everything in it is an addition
  }
  return packagesForFile(path, text)
}

function packagesOnDisk(path) {
  return existsSync(path) ? packagesForFile(path, readFileSync(path, 'utf8')) : new Map()
}

/** Every package version the working tree's package files add over `base`. */
function additionsSince(base) {
  const files = git(['ls-files', ...GATED_FILES]).split('\n').filter(Boolean)
  const added = new Map()
  for (const path of files) {
    for (const pkg of addedPackages(packagesAt(base, path), packagesOnDisk(path))) added.set(packageKey(pkg), pkg)
  }
  return [...added.values()]
}

/**
 * The token and org: from the environment (CI, the cloud worker), else from the local env file.
 * Only these two names are read from the file, so nothing else in it reaches `npm ci`.
 */
function socketCredentials() {
  // The current repo's env files, then astrid-web's (this script's repo), so a Mac session in a
  // sibling repo (`node ../astrid-web/scripts/deps-gate.mjs check`) finds the token too.
  const here = ['.env', '.env.local']
  const web = here.map((file) => fileURLToPath(new URL(`../${file}`, import.meta.url)))
  const local = [...new Set([...web, ...here])].filter((file) => existsSync(file)).map((file) => parseEnv(readFileSync(file, 'utf8')))
  const read = (name) => process.env[name] || local.map((values) => values[name]).filter(Boolean).pop()
  return { token: read('SOCKET_API_TOKEN'), org: read('SOCKET_ORG_SLUG') }
}

async function gate(packages) {
  if (packages.length === 0) {
    console.log('Socket gate: no new package versions.')
    return 0
  }
  try {
    const verdicts = await checkPackages(packages, socketCredentials())
    console.log(formatReport(verdicts))
    return verdicts.every((verdict) => verdict.ok) ? 0 : EXIT_REFUSED
  } catch (error) {
    console.error(`Socket gate: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`  ${packages.length} new package version(s) were not shown to be analyzed.`)
    return EXIT_UNKNOWN
  }
}

async function check(args) {
  const baseAt = args.indexOf('--base')
  const base = baseAt >= 0 ? args[baseAt + 1] : 'origin/main'
  if (!base) throw new Error('Usage: deps:check -- [--base <git ref>]')
  return gate(additionsSince(base))
}

async function add(args) {
  const dev = args.includes('--save-dev') || args.includes('-D')
  const specs = args.filter((arg) => !arg.startsWith('-'))
  if (specs.length === 0) throw new Error('Usage: deps:add -- <name>[@version] [...] [--save-dev]')
  const problems = specs.map(specProblem).filter(Boolean)
  if (problems.length > 0) {
    console.error(problems.map((problem) => `Socket gate: ${problem}`).join('\n'))
    return EXIT_REFUSED
  }
  // A refusal restores these two files, so they must have nothing uncommitted to lose.
  if (git(['status', '--porcelain', '--', 'package.json', 'package-lock.json']).trim()) {
    console.error('Socket gate: package.json or package-lock.json has uncommitted changes. Commit or stash them first.')
    return EXIT_REFUSED
  }
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', ...(dev ? ['--save-dev'] : []), ...specs], { stdio: 'inherit' })
  const status = await gate(additionsSince('HEAD'))
  if (status !== 0) {
    git(['checkout', '--', 'package.json', 'package-lock.json'])
    console.error('Socket gate: nothing was installed; package.json and package-lock.json are restored.')
    return status
  }
  execFileSync('npm', ['ci'], { stdio: 'inherit' })
  return 0
}

const [command, ...rest] = process.argv.slice(2)
const run = command === 'add' ? add : command === 'check' ? check : null
if (!run) {
  console.error('Usage: node scripts/deps-gate.mjs <add|check> ...')
  process.exit(2)
}
run(rest).then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Socket gate: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(EXIT_UNKNOWN)
  },
)
