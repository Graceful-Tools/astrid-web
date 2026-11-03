/**
 * AWTD-1520: `npm run work:start` must build the worktree from origin/main.
 *
 * It branched from the LOCAL `main`, which in this setup is checked out in
 * the hygiene worktree and falls behind. On 2026-11-02 four worktrees began
 * at a commit from weeks earlier, installed that commit's packages, and then
 * failed predeploy once each session reset to origin/main — four false
 * "Predeploy Failed" tasks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addTaskWorktree, parseStartArgs } from '../../scripts/worktree-start'

describe('work:start worktree base (AWTD-1520)', () => {
  let root: string
  let repo: string
  let origin: string
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()

  function commit(cwd: string, file: string, text: string) {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', file)
    git(cwd, 'commit', '-qm', text)
    return git(cwd, 'rev-parse', 'HEAD')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'astrid-worktree-start-'))
    origin = join(root, 'origin.git')
    repo = join(root, 'repo')
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { env })
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.name', 'Worktree test')
    git(repo, 'config', 'user.email', 'worktree@example.test')
    git(repo, 'remote', 'add', 'origin', origin)
    commit(repo, 'a.txt', 'old main')
    git(repo, 'push', '-q', '-u', 'origin', 'main')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** Someone else merges to origin; this clone's main and origin/main stay behind. */
  function advanceOrigin(): string {
    const other = join(root, 'other')
    execFileSync('git', ['clone', '-q', origin, other], { env })
    git(other, 'config', 'user.name', 'Other')
    git(other, 'config', 'user.email', 'other@example.test')
    const sha = commit(other, 'b.txt', 'new main')
    git(other, 'push', '-q', 'origin', 'main')
    return sha
  }

  it('AWTD-1520: starts the worktree at the freshly fetched origin/main, not the stale local main', () => {
    const staleLocal = git(repo, 'rev-parse', 'main')
    const fresh = advanceOrigin()
    expect(git(repo, 'rev-parse', 'origin/main')).toBe(staleLocal)

    const worktree = join(root, 'wt')
    const base = addTaskWorktree({ repoDir: repo, branch: 'task/x', worktreePath: worktree, env })

    expect(base).toBe(fresh)
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(fresh)
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('task/x')
    // The local main is left alone: it may be checked out in another worktree.
    expect(git(repo, 'rev-parse', 'main')).toBe(staleLocal)
  })

  it('AWTD-1520: refuses when origin cannot be fetched rather than falling back to a stale base', () => {
    git(repo, 'remote', 'set-url', 'origin', join(root, 'missing.git'))
    expect(() => addTaskWorktree({ repoDir: repo, branch: 'task/x', worktreePath: join(root, 'wt'), env })).toThrow()
  })
})

describe('work:start arguments (AWTD-1520)', () => {
  it('names the branch task/<slug> by default', () => {
    expect(parseStartArgs(['fix-search-clear'])).toEqual({ taskIdentifier: 'fix-search-clear', description: '', branch: undefined })
  })

  it('takes --branch so an agent can name it agent/<harness>/<KEY>-... up front', () => {
    expect(parseStartArgs(['awtd-1520', '--branch', 'agent/claude-code/AWTD-1520-x', 'some', 'words'])).toEqual({
      taskIdentifier: 'awtd-1520', description: 'some words', branch: 'agent/claude-code/AWTD-1520-x',
    })
    expect(parseStartArgs(['--branch=agent/codex/AWTD-1-y', 'slug'])).toMatchObject({ taskIdentifier: 'slug', branch: 'agent/codex/AWTD-1-y' })
  })

  it('refuses when npm swallowed --branch (no `--` separator), rather than quietly using task/<slug>', () => {
    // `npm run work:start slug --branch x/y` reaches the script as ['slug', 'x/y'], npm_config_branch set.
    expect(() => parseStartArgs(['slug', 'x/y'], { npm_config_branch: 'true' })).toThrow(/npm run work:start -- /)
    expect(parseStartArgs(['slug', '--branch', 'x/y'], { npm_config_branch: 'true' })).toMatchObject({ branch: 'x/y' })
  })

  it('rejects --branch with no name', () => {
    expect(() => parseStartArgs(['slug', '--branch'])).toThrow(/--branch/)
  })
})
