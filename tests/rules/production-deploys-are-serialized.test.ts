/**
 * ADEV-26: production deploys run one at a time, and never put an older commit over a
 * newer live one.
 *
 * Before this, production-deployment.yml had no concurrency group: two dispatches deployed
 * at once, and the older sha could finish last and overwrite the newer one. With N cloud
 * workers handing off together, two dispatches minutes apart are ordinary.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runWorkflowStep, workflowStep } from '../utils/workflow-step'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const WORKFLOW = '.github/workflows/production-deployment.yml'
const FRESH = 'Skip when production already serves a newer commit'
const workflow = () => yaml.load(readFileSync(WORKFLOW, 'utf8'))

describe('ADEV-26: production deploys are serialized', () => {
  it('ADEV-26: one deploy at a time, and a running deploy is never cancelled', () => {
    expect(workflow().concurrency).toEqual({ group: 'production-deployment', 'cancel-in-progress': false })
  })

  it('ADEV-26: the deploy job checks the live commit first, and every later step obeys it', () => {
    const job = workflow().jobs['deploy-production']
    const steps = job.steps as Array<Record<string, any>>
    expect(steps[0].with?.['fetch-depth']).toBe(0)
    const fresh = steps.findIndex(s => s.name === FRESH)
    expect(fresh).toBe(1)
    expect(steps[fresh].id).toBe('fresh')
    for (const step of steps.slice(fresh + 1)) {
      expect(step.if, step.name).toBe("steps.fresh.outputs.superseded != 'true'")
    }
    expect(job.outputs.superseded).toBe('${{ steps.fresh.outputs.superseded }}')
  })

  it('ADEV-26: a skipped older deploy neither health-checks the older sha nor moves prod back', () => {
    const jobs = workflow().jobs
    expect(jobs['health-check'].if).toContain("needs.deploy-production.outputs.superseded != 'true'")
    // advance-prod-branch still needs a passing health check, which a skipped one is not.
    expect(jobs['advance-prod-branch'].if).toBe("always() && needs.health-check.result == 'success'")
  })

  it('ADEV-26: leaves the destructive-migration gate exactly as it was', () => {
    const wf = workflow()
    expect(wf.on.workflow_dispatch.inputs.allow_destructive_migrations).toMatchObject({ default: false, type: 'boolean' })
    expect(readFileSync(WORKFLOW, 'utf8')).toContain('name: Guard Destructive Migrations')
  })

  describe('the freshness check, executed', () => {
    let dir: string
    let older: string
    let newer: string
    let unrelated: string
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim()

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'deploy-fresh-'))
      git('init', '-q', '-b', 'main')
      git('config', 'user.name', 'Fresh test')
      git('config', 'user.email', 'fresh@example.test')
      git('config', 'commit.gpgsign', 'false')
      git('commit', '-q', '--allow-empty', '-m', 'older')
      older = git('rev-parse', 'HEAD')
      git('commit', '-q', '--allow-empty', '-m', 'newer')
      newer = git('rev-parse', 'HEAD')
      git('switch', '-q', '--orphan', 'side')
      git('commit', '-q', '--allow-empty', '-m', 'unrelated')
      unrelated = git('rev-parse', 'HEAD')
      git('switch', '-q', 'main')
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    /** Runs the step with a fake curl answering `health` (or failing when null). */
    const check = (sha: string, health: string | null) => {
      writeFileSync(join(dir, 'curl'), health === null
        ? '#!/bin/sh\nexit 7\n'
        : `#!/bin/sh\nprintf '%s' '${health}'\n`, { mode: 0o755 })
      const output = join(dir, 'github-output')
      writeFileSync(output, '')
      const result = runWorkflowStep(workflowStep(WORKFLOW, 'deploy-production', FRESH), {
        cwd: dir,
        env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_SHA: sha, PRODUCTION_URL: 'https://prod.example.test', GITHUB_OUTPUT: output },
      })
      return { ...result, out: readFileSync(output, 'utf8') }
    }
    const health = (sha: string) => JSON.stringify({ status: 'ok', commitSha: sha })

    it('ADEV-26: skips with a notice when production serves a newer commit that contains this one', () => {
      const r = check(older, health(newer))
      expect(r.status, r.stderr).toBe(0)
      expect(r.out).toBe('superseded=true\n')
      expect(r.stdout).toContain('::notice::Production already serves')
    })

    it('ADEV-26: deploys a newer commit over an older live one', () => {
      expect(check(newer, health(older)).out).toBe('superseded=false\n')
    })

    it('ADEV-26: redeploys the live commit itself, as before (how a Vercel env change is picked up)', () => {
      expect(check(newer, health(newer)).out).toBe('superseded=false\n')
    })

    it('ADEV-26: deploys when the live commit is unrelated, unknown, unreadable or unreachable — skips only on proof', () => {
      expect(check(older, health(unrelated)).out).toBe('superseded=false\n')
      expect(check(older, health('0123456789abcdef0123456789abcdef01234567')).out).toBe('superseded=false\n')
      expect(check(older, '{"status":"ok"}').out).toBe('superseded=false\n')
      expect(check(older, null).out).toBe('superseded=false\n')
    })
  })
})
