#!/usr/bin/env tsx
/**
 * AWTD-1701: compare web's contract fixtures with astrid-core `origin/main`, and optionally
 * open the refresh PR there.
 *
 *   npx tsx scripts/sync-core-fixtures.ts [--core-dir ../astrid-core]            # exit 1 if stale
 *   npx tsx scripts/sync-core-fixtures.ts --open-pr [--core-dir ../astrid-core]  # open the PR
 *
 * Run on every ship tick by scripts/land-and-deploy.ts (with `--clone`), so a web contract
 * change leaves core main red for one tick, not until somebody copies files by hand.
 * `--open-pr` needs `gh` authenticated with a token that can push to astrid-core.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  diffFixtureSets,
  isInSync,
  openRefreshPullRequest,
  REFRESH_BRANCH_PREFIX,
  refreshPullRequestBody,
  type FixtureSet,
} from './lib/core-fixture-sync'

const CORE_REPO = 'Graceful-Tools/astrid-core'
const FIXTURES = 'contracts/fixtures'
const webRoot = resolve(__dirname, '..')

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

// `--clone` makes its own checkout (the ship job has none); GH_TOKEN must reach astrid-core.
const coreDir = flag('--clone')
  ? join(mkdtempSync(join(tmpdir(), 'astrid-core-')), 'astrid-core')
  : resolve(webRoot, option('--core-dir', '../astrid-core'))
if (flag('--clone')) {
  execFileSync('gh', ['repo', 'clone', CORE_REPO, coreDir], { stdio: 'inherit' })
  execFileSync('git', ['-C', coreDir, 'config', 'user.name', 'Astrid fixture sync'])
  execFileSync('git', ['-C', coreDir, 'config', 'user.email', 'noreply@astrid.cc'])
  // ADEV-325: `gh repo clone` leaves no credential helper, so the push below died with
  // "could not read Username" on every ship tick. Let gh answer with the same GH_TOKEN.
  execFileSync('git', ['-C', coreDir, 'config', 'credential.helper', '!gh auth git-credential'])
}
const git = (...a: string[]) => execFileSync('git', ['-C', coreDir, ...a], { encoding: 'utf8' }).trim()

function webFixtures(): FixtureSet {
  const dir = join(webRoot, FIXTURES)
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
  )
}

// Read core's committed copy at origin/main, not its working tree: a stale checkout would
// otherwise report drift that main does not have.
function coreFixtures(): FixtureSet {
  const names = git('ls-tree', '--name-only', 'origin/main', `${FIXTURES}/`)
    .split('\n')
    .filter((p) => p.endsWith('.json'))
  return Object.fromEntries(
    names.map((p) => [p.slice(FIXTURES.length + 1), execFileSync('git', ['-C', coreDir, 'show', `origin/main:${p}`], { encoding: 'utf8' })]),
  )
}

git('fetch', 'origin', 'main')
const web = webFixtures()
const diff = diffFixtureSets(web, coreFixtures())

if (isInSync(diff)) {
  console.log('astrid-core fixtures match astrid-web.')
  process.exit(0)
}

console.error('astrid-core contracts/fixtures is behind astrid-web:')
for (const name of diff.stale) console.error(`  changed  ${name}`)
for (const name of diff.missing) console.error(`  missing  ${name}`)

if (!flag('--open-pr')) {
  console.error('Run with --open-pr to open the refresh PR on astrid-core.')
  process.exit(1)
}

const webSha = execFileSync('git', ['-C', webRoot, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
const branch = `${REFRESH_BRANCH_PREFIX}web-${webSha}`
const existing = openRefreshPullRequest(
  JSON.parse(
    execFileSync(
      'gh',
      ['pr', 'list', '--repo', CORE_REPO, '--state', 'open', '--limit', '100', '--json', 'headRefName,url'],
      { encoding: 'utf8' },
    ),
  ),
)
if (existing) {
  console.log(`Refresh PR already open: ${existing}`)
  process.exit(0)
}

git('checkout', '-B', branch, 'origin/main')
for (const name of [...diff.stale, ...diff.missing]) {
  copyFileSync(join(webRoot, FIXTURES, name), join(coreDir, FIXTURES, name))
}
git('add', FIXTURES)
git('commit', '-m', `chore(contracts): refresh fixtures from astrid-web ${webSha} (AWTD-1701)`)
git('push', '--force-with-lease', 'origin', branch)
const url = execFileSync(
  'gh',
  [
    'pr', 'create', '--repo', CORE_REPO, '--base', 'main', '--head', branch,
    '--title', `chore(contracts): refresh fixtures from astrid-web ${webSha}`,
    '--body', refreshPullRequestBody(diff, webSha),
  ],
  { encoding: 'utf8' },
).trim()
console.log(`Opened ${url}`)
