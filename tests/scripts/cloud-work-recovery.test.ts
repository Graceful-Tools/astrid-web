import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runWorkflowStep, workflowStep } from '../utils/workflow-step'

const recovery = workflowStep('.github/workflows/agent-run.yml', 'run', 'Preserve unfinished work')

describe('cloud work recovery (AWTD-1383)', () => {
  let root: string
  let work: string
  let origin: string
  const stepEnv = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    ASTRID_FIXALL_HARNESS: 'codex', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' }
  const env = { ...process.env, ...stepEnv }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim()
  const remote = (ref: string) => execFileSync('git', ['--git-dir', origin, 'rev-parse', ref], { env, encoding: 'utf8' }).trim()
  const recover = () => runWorkflowStep(recovery, { cwd: work, env: stepEnv })
  let base: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'astrid-cloud-recovery-'))
    work = join(root, 'work')
    origin = join(root, 'origin.git')
    mkdirSync(work)
    execFileSync('git', ['init', '--bare', '-q', origin], { env })
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Recovery test')
    git('config', 'user.email', 'recovery@example.test')
    git('remote', 'add', 'origin', origin)
    writeFileSync(join(work, '.gitignore'), '.agent-output/\n')
    writeFileSync(join(work, 'task.txt'), 'initial\n')
    git('add', '.')
    git('commit', '-qm', 'initial')
    git('push', '-q', '-u', 'origin', 'main')
    base = git('rev-parse', 'HEAD')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function commitTask() {
    writeFileSync(join(work, 'task.txt'), 'task implemented\n')
    git('add', 'task.txt')
    git('commit', '-qm', 'task implementation')
    return git('rev-parse', 'HEAD')
  }

  it('pushes a clean local task commit that was never pushed, without adding a WIP commit', () => {
    git('switch', '-qc', 'agent/codex/AWTD-1383')
    const head = commitTask()
    expect(git('status', '--porcelain')).toBe('')
    expect(recover().status).toBe(0)
    expect(remote('refs/heads/agent/codex/AWTD-1383')).toBe(head)
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(remote('refs/heads/main')).toBe(base)
  })

  it.each(['main', 'detached'])('preserves clean local commits from %s only on a recovery branch', state => {
    if (state === 'detached') git('checkout', '-q', '--detach')
    const head = commitTask()
    expect(recover().status).toBe(0)
    expect(git('branch', '--show-current')).toMatch(/^agent\/codex\/recovery-123/)
    expect(remote(`refs/heads/${git('branch', '--show-current')}`)).toBe(head)
    expect(remote('refs/heads/main')).toBe(base)
  })

  it('commits dirty WIP before preserving it, never onto remote main', () => {
    writeFileSync(join(work, 'task.txt'), 'unfinished work\n')
    expect(recover().status).toBe(0)
    expect(git('log', '-1', '--format=%s')).toBe('wip: agent run 123 UNFINISHED, UNVERIFIED')
    expect(remote(`refs/heads/${git('branch', '--show-current')}`)).toBe(git('rev-parse', 'HEAD'))
    expect(remote('refs/heads/main')).toBe(base)
  })

  it('retains a verifiable artifact bundle of unpushed commits when the recovery push fails', () => {
    git('switch', '-qc', 'agent/codex/AWTD-1383')
    const head = commitTask()
    writeFileSync(join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect(recover().status).not.toBe(0)
    const bundle = join(work, '.agent-output', 'recovery.bundle')
    expect(git('bundle', 'verify', bundle)).toContain('bundle')
    expect(git('bundle', 'list-heads', bundle)).toContain(head)
    expect(readFileSync(join(work, '.agent-output', 'recovery-head.txt'), 'utf8').trim()).toBe(head)
    expect(remote('refs/heads/main')).toBe(base)
  })

  it('leaves an already-pushed clean checkout alone', () => {
    expect(recover().status).toBe(0)
    expect(git('branch', '--show-current')).toBe('main')
    expect(git('rev-parse', 'HEAD')).toBe(base)
  })
})
