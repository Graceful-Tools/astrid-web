/**
 * A scheduled /fixall run that dies mid-task must not wedge the loop.
 *
 * 2026-09-27, twice: a run ended with uncommitted work on its task branch
 * (AWTD-1024 at 08:20, AWTD-1025 at 16:20 — the second killed by the 50m
 * watchdog). The cleanup logged "leaving it for a human", guard 2 refused the
 * dirty tree, and every later tick skipped while Ready work waited.
 *
 * The cleanup block is RUN here, against a scratch repo with a bare origin,
 * rather than pattern-matched: what matters is where HEAD and the work end up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const cleanup = loop.slice(loop.indexOf('SAVED_BRANCH=""'), loop.indexOf('# Phase two of waking'))

let dir: string
let repo: string

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

function runCleanup(): string {
  const script = `post_to_list() { echo "POSTED: $1"; }\nSTATUS=143\nREPO="${repo}"\n${cleanup}`
  return execFileSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8' })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-cleanup-'))
  const origin = join(dir, 'origin.git')
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git('config', 'user.email', 'loop@example.com')
  git('config', 'user.name', 'loop')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  git('remote', 'add', 'origin', origin)
  git('push', '-q', '-u', 'origin', 'main')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the scheduled loop saves a killed run instead of wedging', () => {
  it('commits uncommitted work on the task branch, pushes it, and returns to main', () => {
    git('checkout', '-q', '-b', 'fix/awtd-1025-chip')
    writeFileSync(join(repo, 'a.txt'), 'half done\n')
    writeFileSync(join(repo, 'new.ts'), 'export {}\n')

    const out = runCleanup()

    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git('status', '--porcelain')).toBe('')
    expect(git('log', '-1', '--format=%s', 'origin/fix/awtd-1025-chip')).toMatch(/UNFINISHED, UNVERIFIED/)
    expect(git('show', 'origin/fix/awtd-1025-chip:a.txt')).toBe('half done')
    expect(git('show', 'origin/fix/awtd-1025-chip:new.ts')).toBe('export {}')
    expect(out).toMatch(/POSTED: .*saved unfinished work on `fix\/awtd-1025-chip`/)
  })

  it('never commits to main — work left on main is snapshotted to a wip/ branch', () => {
    writeFileSync(join(repo, 'a.txt'), 'dirtied on main\n')

    runCleanup()

    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git('log', '-1', '--format=%s', 'main')).toBe('init')
    expect(git('show', 'origin/main:a.txt')).toBe('one')
    const wip = git('branch', '-r', '--list', 'origin/wip/fixall-web-*')
    expect(wip).not.toBe('')
    expect(git('show', `${wip}:a.txt`)).toBe('dirtied on main')
  })

  it("AWTD-1095: leaves another session's edits on main in its tree, staged state and all", () => {
    // 2026-10-05 08:10: an interactive session was editing main while a tick
    // ran. The cleanup took its edits for the run's WIP, committed them to a
    // wip/ branch and checked out main — removing them from the session's tree.
    writeFileSync(join(repo, 'a.txt'), 'interactive edit\n')
    writeFileSync(join(repo, 'staged.ts'), 'export const x = 1\n')
    git('add', 'staged.ts')
    writeFileSync(join(repo, 'untracked.md'), 'notes\n')
    const before = git('status', '--porcelain')

    const out = runCleanup()

    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git('status', '--porcelain')).toBe(before)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('interactive edit\n')
    expect(readFileSync(join(repo, 'untracked.md'), 'utf8')).toBe('notes\n')
    // Still recoverable from origin, should the edits turn out to be the run's.
    const wip = git('branch', '-r', '--list', 'origin/wip/fixall-web-*')
    expect(git('show', `${wip}:untracked.md`)).toBe('notes')
    expect(git('show', `${wip}:staged.ts`)).toBe('export const x = 1')
    expect(out).toMatch(/POSTED: .*left uncommitted changes on main/)
  })

  it('leaves a clean main alone', () => {
    const out = runCleanup()
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git('log', '--oneline').split('\n')).toHaveLength(1)
    expect(out).not.toMatch(/POSTED/)
  })

  it('bypasses the pre-commit hook, which would refuse unverified work', () => {
    expect(cleanup).toMatch(/git commit -q --no-verify/)
  })
})

describe('guard 2 treats unpushed commits on main as work in progress (AWTD-1095)', () => {
  const guard2 = loop.slice(loop.indexOf('skip_guard2() {'), loop.indexOf('rm -f "$STUCK_FILE"'))

  function runGuard2(): string {
    const script = [
      'post_to_list() { echo "POSTED: $1"; }',
      `STUCK_DIR="${dir}/stuck"`,
      'STUCK_FILE="$STUCK_DIR/stuck-web"',
      'STUCK_ALERT_MINUTES=120',
      guard2,
      'echo PASSED',
    ].join('\n')
    return execFileSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8' })
  }

  it('skips a clean main that has commits origin/main lacks', () => {
    // 2026-10-05 07:53: an interactive session's tree was momentarily clean
    // between commits, with main ahead of origin. The tick started anyway.
    writeFileSync(join(repo, 'a.txt'), 'committed, not pushed\n')
    git('commit', '-q', '-am', 'local work')

    const out = runGuard2()

    expect(out).toMatch(/RESULT: SKIPPED — main has 1 commit\(s\) origin\/main lacks/)
    expect(out).not.toMatch(/PASSED/)
    expect(git('log', '-1', '--format=%s')).toBe('local work')
  })

  it('passes a clean main that matches origin/main', () => {
    expect(runGuard2()).toMatch(/PASSED/)
  })
})

describe('the scheduled loop takes one task per run', () => {
  it('caps the run so it fits inside the watchdog', () => {
    expect(loop).toMatch(/export ASTRID_FIXALL_MAX_TASKS="\$\{FIXALL_MAX_TASKS:-1\}"/)
    const fixall = readFileSync(join(process.cwd(), '.claude/commands/fixall.md'), 'utf8')
    expect(fixall).toMatch(/ASTRID_FIXALL_MAX_TASKS/)
  })

  it('gives one task a watchdog it can finish inside', () => {
    // 2026-09-27: AWTD-1007, alone in its run, still hit the old 50m limit.
    expect(loop).toMatch(/MAX_MINUTES="\$\{FIXALL_MAX_MINUTES:-75\}"/)
  })
})
