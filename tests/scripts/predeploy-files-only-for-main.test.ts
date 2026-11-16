/**
 * ADEV-31: predeploy files a "Predeploy Failed" task only for main.
 *
 * On 2026-11-16 all three such tasks on the web board (ADEV-28/29/30) came from
 * predeploy runs on feature branches: an unfinished agent WIP commit, the
 * ADEV-26 branch and the AWTD-1693 branch. None was a failure on main, yet each
 * sat at the top of Ready (★★★), outranking real work. A branch's red gate is
 * that branch's business; the board hears about main.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { predeployReportScope } from '../../scripts/lib/predeploy-report-tasks'

describe('predeployReportScope (ADEV-31)', () => {
  let root: string
  let work: string
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()
  const commit = (msg: string) => {
    writeFileSync(join(work, 'f.txt'), msg)
    git(work, 'add', '.')
    git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'predeploy-scope-'))
    const origin = join(root, 'origin.git')
    work = join(root, 'work')
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    git(root, 'clone', '-q', origin, work)
    git(work, 'checkout', '-q', '-b', 'main')
    commit('one')
    git(work, 'push', '-q', 'origin', 'main')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('files for main (HEAD is origin/main)', () => {
    expect(predeployReportScope({ cwd: work, env: {} }).file).toBe(true)
  })

  it('files for a merged commit behind main (the gate worktree)', () => {
    const merged = git(work, 'rev-parse', 'HEAD')
    commit('two')
    git(work, 'push', '-q', 'origin', 'main')
    git(work, 'checkout', '-q', '--detach', merged)
    expect(predeployReportScope({ cwd: work, env: {} }).file).toBe(true)
  })

  it('does not file for a branch commit that is not on main', () => {
    git(work, 'checkout', '-q', '-b', 'agent/claude/x')
    commit('branch work')
    const scope = predeployReportScope({ cwd: work, env: {} })
    expect(scope.file).toBe(false)
    expect(scope.reason).toContain('not on origin/main')
  })

  it('ADEV-44: does not file for a dirty working tree sitting on main', () => {
    writeFileSync(join(work, 'f.txt'), 'staged wip')
    git(work, 'add', '.')
    const scope = predeployReportScope({ cwd: work, env: {} })
    expect(scope.file).toBe(false)
    expect(scope.reason).toContain('uncommitted')
    expect(predeployReportScope({ cwd: work, env: { ASTRID_PREDEPLOY_FILE_TASKS: '1' } }).file).toBe(true)
  })

  it('ASTRID_PREDEPLOY_FILE_TASKS=1 forces filing, =0 forbids it', () => {
    git(work, 'checkout', '-q', '-b', 'agent/claude/x')
    commit('branch work')
    expect(predeployReportScope({ cwd: work, env: { ASTRID_PREDEPLOY_FILE_TASKS: '1' } }).file).toBe(true)
    git(work, 'checkout', '-q', 'main')
    expect(predeployReportScope({ cwd: work, env: { ASTRID_PREDEPLOY_FILE_TASKS: '0' } }).file).toBe(false)
  })

  it('without an origin/main ref (a shallow CI checkout) it trusts GITHUB_REF', () => {
    git(work, 'update-ref', '-d', 'refs/remotes/origin/main')
    expect(predeployReportScope({ cwd: work, env: { GITHUB_REF: 'refs/heads/main' } }).file).toBe(true)
    expect(predeployReportScope({ cwd: work, env: { GITHUB_REF: 'refs/pull/9/merge' } }).file).toBe(false)
    expect(predeployReportScope({ cwd: work, env: {} }).file).toBe(false)
  })

  it('the predeploy script asks the scope before it files', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(join(process.cwd(), 'scripts/predeploy-self-healing.ts'), 'utf8')
    expect(src).toContain('predeployReportScope(')
  })
})
