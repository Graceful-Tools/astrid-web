/**
 * scripts/advance-prod-branch.sh points `prod` at what production serves.
 * Exercised against throwaway git repos, because the interesting cases —
 * first deploy, fast-forward, rollback, redeploy — are all about ref history.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SCRIPT = join(process.cwd(), 'scripts/advance-prod-branch.sh')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
}

let dir: string
let work: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim()
const advance = (sha: string) => execFileSync('bash', [SCRIPT, sha], { cwd: work, env, encoding: 'utf8' })
const remoteRef = (ref: string) =>
  execFileSync('git', ['--git-dir', join(dir, 'origin.git'), 'rev-parse', ref], { env, encoding: 'utf8' }).trim()
const commit = (msg: string) => { git('commit', '-q', '--allow-empty', '-m', msg); return git('rev-parse', 'HEAD') }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prod-branch-'))
  execFileSync('git', ['init', '-q', '--bare', join(dir, 'origin.git')], { env })
  work = join(dir, 'w')
  execFileSync('git', ['clone', '-q', join(dir, 'origin.git'), work], { env, stdio: 'ignore' })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('advance-prod-branch.sh', () => {
  it('creates prod on the first deploy and tags it', () => {
    const a = commit('a')
    const out = advance(a)
    expect(remoteRef('refs/heads/prod')).toBe(a)
    expect(out).toMatch(new RegExp(`tagged prod-\\d{8}-\\d{6}-${a.slice(0, 7)}`))
  })

  it('fast-forwards on a normal deploy', () => {
    const a = commit('a'); advance(a)
    commit('b'); const c = commit('c')
    expect(advance(c)).toMatch(/fast-forward, 2 commits/)
    expect(remoteRef('refs/heads/prod')).toBe(c)
  })

  it('follows a rollback, with a warning', () => {
    const a = commit('a'); advance(a)
    const b = commit('b'); advance(b)
    const out = advance(a)
    expect(out).toMatch(/::warning::.*NOT a fast-forward/)
    expect(remoteRef('refs/heads/prod')).toBe(a)
  })

  it('does nothing on a redeploy of the same commit', () => {
    const a = commit('a'); advance(a)
    expect(advance(a)).toMatch(/already at/)
  })
})

describe('production-deployment.yml', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/production-deployment.yml'), 'utf8')
  const job = wf.slice(wf.indexOf('advance-prod-branch:'))

  it('moves prod only after the health check succeeds', () => {
    expect(job).toMatch(/needs: \[deploy-production, health-check\]/)
    expect(job).toMatch(/needs\.health-check\.result == 'success'/)
    expect(job).toMatch(/contents: write/)
    expect(job).toMatch(/fetch-depth: 0/)
    expect(job).toMatch(/advance-prod-branch\.sh "\$GITHUB_SHA"/)
  })
})
