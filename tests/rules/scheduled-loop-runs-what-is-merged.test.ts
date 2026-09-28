/**
 * The scheduled loop runs what is merged, not what someone last pulled by hand.
 *
 * 2026-09-27: a merged loop fix sat unused in astrid-ios until a human pulled it,
 * because nothing updates a loop's checkout. Each tick that passes the guards now
 * fast-forwards main, and restarts itself when the loop script changed.
 *
 * The block is RUN against a scratch repo with a bare origin; `exec` is stubbed so
 * the test can see the restart without replacing the test's own shell.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const selfUpdate = loop.slice(
  loop.indexOf('# ── Run what is merged'),
  loop.indexOf('# ── Guard 3'),
)

let dir: string
let repo: string
let upstream: string

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function pushUpstream(file: string, line: string) {
  mkdirSync(join(upstream, 'scripts'), { recursive: true })
  appendFileSync(join(upstream, file), `${line}\n`)
  gitIn(upstream, 'add', '-A')
  gitIn(upstream, 'commit', '-q', '-m', `upstream: ${file}`)
  gitIn(upstream, 'push', '-q', 'origin', 'main')
}

function run(env: Record<string, string> = {}): string {
  const script = `exec() { echo "EXEC $*"; }\nset -- --tick\n${selfUpdate}`
  return execFileSync('bash', ['-c', script, 'scripts/fixall-loop.sh'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, FIXALL_SELF_UPDATED: '', FIXALL_FORCE: '', ...env },
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-selfupdate-'))
  const origin = join(dir, 'origin.git')
  repo = join(dir, 'repo')
  upstream = join(dir, 'upstream')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  gitIn(repo, 'config', 'user.email', 'loop@example.com')
  gitIn(repo, 'config', 'user.name', 'loop')
  mkdirSync(join(repo, 'scripts'))
  writeFileSync(join(repo, 'scripts/fixall-loop.sh'), '# loop v1\n')
  gitIn(repo, 'add', '-A')
  gitIn(repo, 'commit', '-q', '-m', 'init')
  gitIn(repo, 'remote', 'add', 'origin', origin)
  gitIn(repo, 'push', '-q', '-u', 'origin', 'main')
  execFileSync('git', ['clone', '-q', origin, upstream])
  gitIn(upstream, 'config', 'user.email', 'up@example.com')
  gitIn(upstream, 'config', 'user.name', 'up')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the scheduled loop runs what is merged', () => {
  it('fast-forwards main to origin/main without restarting when the loop is unchanged', () => {
    pushUpstream('NOTES.md', 'merged elsewhere')
    const out = run()
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(gitIn(upstream, 'rev-parse', 'HEAD'))
    expect(out).toMatch(/updated main/)
    expect(out).not.toMatch(/EXEC/)
  })

  it('restarts on the new version when the loop script itself changed, passing its args', () => {
    pushUpstream('scripts/fixall-loop.sh', '# loop v2')
    const out = run()
    expect(out).toMatch(/restarting on the new version/)
    expect(out).toMatch(/EXEC scripts\/fixall-loop\.sh --tick/)
    expect(readFileSync(join(repo, 'scripts/fixall-loop.sh'), 'utf8')).toContain('loop v2')
  })

  it('does not update twice once restarted, or at all under FIXALL_FORCE', () => {
    pushUpstream('NOTES.md', 'merged elsewhere')
    const before = gitIn(repo, 'rev-parse', 'HEAD')
    run({ FIXALL_SELF_UPDATED: '1' })
    run({ FIXALL_FORCE: '1' })
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(before)
  })

  it('degrades to the current checkout when origin cannot be reached', () => {
    gitIn(repo, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))
    const out = run()
    expect(out).toMatch(/could not fast-forward main/)
  })
})
