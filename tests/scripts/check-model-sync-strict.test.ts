/**
 * check:model-sync --strict must FAIL when it cannot verify (task 1985804a).
 *
 * The check had run as a permanent no-op in CI: no token was mapped into the
 * step's env, every run took the "UNVERIFIED — skipping" path, and exit 0
 * rendered as a passing gate in both deployment workflows. --strict turns
 * every skip path into a failure so CI regresses loudly (not silently) the
 * moment the token goes missing again. The default (non-strict) behavior is
 * unchanged so local runs without a token stay a choice, not an error.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

const SCRIPT = path.join(process.cwd(), 'scripts', 'check-model-sync.ts')

// No GitHub token of any spelling reaches the child.
const tokenlessEnv = { ...process.env }
delete tokenlessEnv.ASTRID_IOS_GITHUB_TOKEN
delete tokenlessEnv.GITHUB_TOKEN
delete tokenlessEnv.GH_TOKEN

const run = (...args: string[]) =>
  spawnSync('npx', ['tsx', SCRIPT, ...args], {
    env: tokenlessEnv,
    encoding: 'utf8',
    timeout: 60_000,
  })

describe('check-model-sync --strict (task 1985804a)', () => {
  it('exits 1 when it cannot verify under --strict', () => {
    const result = run('--strict')
    expect(result.stdout).toContain('UNVERIFIED')
    expect(result.status).toBe(1)
  })

  it('still exits 0 on the tokenless skip without --strict', () => {
    const result = run()
    expect(result.stdout).toContain('UNVERIFIED')
    expect(result.status).toBe(0)
  })
})
