/**
 * No workflow rides `ubuntu-latest` through the 26.04 rollout (AWTD-1202).
 *
 * `ubuntu-latest` moves from Ubuntu 24.04 to 26.04 GRADUALLY between
 * 2026-10-19 and 2026-11-19 (GitHub changelog, 2026-09-17). Gradually is the
 * problem: during that window different jobs of the SAME run can land on
 * different images. production-deployment.yml has six jobs on six runners, so
 * one deploy could run Quality Gates on 24.04 and Database Migration on 26.04
 * — and a failure like that reads as flake, which is the expensive way to find
 * out. The official breaking-changes list (actions/runner-images#14747) is
 * published empty, so there is nothing to diff against; pinning is the only
 * way to know what a deploy ran on.
 *
 * THIS PIN IS A DEFERRAL, NOT A DESTINATION. 24.04 goes away eventually, so
 * moving off it is tracked on the board with a recheck date rather than by a
 * test that would start failing on a date nobody chose.
 *
 * Self-hosted jobs are exempt: they never resolve `ubuntu-latest` at all.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = join(process.cwd(), '.github/workflows')
const workflows = readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))

/** Every `runs-on:` line in the repo, with its file and line number. */
const runsOnLines = workflows.flatMap(file =>
  readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .map((text, i) => ({ file, line: i + 1, text }))
    .filter(l => /^\s*runs-on:/.test(l.text)),
)

const DEPLOY_WORKFLOWS = ['production-deployment.yml', 'preview-deployment.yml']

describe('CI runners are pinned, not latest (AWTD-1202)', () => {
  it('finds the runs-on lines at all, so a rename cannot make this vacuous', () => {
    expect(workflows.length).toBeGreaterThan(5)
    expect(runsOnLines.length).toBeGreaterThan(20)
  })

  it('names no ubuntu-latest anywhere, including inside a conditional runner', () => {
    const offenders = runsOnLines
      .filter(l => l.text.includes('ubuntu-latest'))
      .map(l => `${l.file}:${l.line}`)
    expect(offenders).toEqual([])
  })

  it('pins every job on the deploy path to one explicit image', () => {
    for (const file of DEPLOY_WORKFLOWS) {
      const lines = runsOnLines.filter(l => l.file === file)
      expect(lines.length).toBeGreaterThan(0)
      for (const l of lines) {
        // An explicit ubuntu-NN.NN, or a self-hosted label set. Never "latest".
        expect(l.text).toMatch(/ubuntu-\d\d\.\d\d|self-hosted/)
      }
    }
  })

  it('targets no astrid-web self-hosted runner — it was retired (AWTD-1363)', () => {
    // A job aimed at a runner that no longer exists queues forever instead of failing.
    const retired = runsOnLines.filter(l => l.text.includes('astrid-web'))
    expect(retired).toEqual([])
  })
})
