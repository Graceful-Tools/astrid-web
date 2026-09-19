/**
 * AWTD-959 — the production deploy job must report what actually happened.
 *
 * Two runs on SHA 25712912 (35388608403, 35392381194) reported the deploy as
 * FAILED about a deploy that had in fact succeeded. The step log is the whole
 * story:
 *
 *   20:39:34  Deploying to production...
 *   20:57:43  ##[error]The operation was canceled.
 *
 * Eighteen minutes of silence, because the command was
 * `DEPLOYMENT_OUTPUT=$(vercel deploy ... 2>&1)` — every byte of progress went
 * into a variable that is only echoed AFTER the command returns, so a hang
 * prints nothing at all. `vercel deploy` blocks until the deployment is READY
 * and carries no timeout of its own, so it consumed the job's entire
 * `timeout-minutes: 20` and the runner cancelled it. Then `health-check`, being
 * `needs:` the deploy job, was skipped — deleting the only automated
 * verification that production was up, on the one run where production was
 * down.
 *
 * This is a workflow-shape ratchet. It cannot run GitHub Actions, so it pins
 * the four properties whose absence caused the incident, each one traceable to
 * a line in those logs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WORKFLOW = '.github/workflows/production-deployment.yml'
const source = readFileSync(WORKFLOW, 'utf8')

/** The `Deploy to Vercel` step's `run:` block. */
function deployStep(): string {
  const start = source.indexOf('name: Deploy to Vercel')
  expect(start, `${WORKFLOW} no longer has a "Deploy to Vercel" step`).toBeGreaterThan(-1)
  const rest = source.slice(start)
  // The step ends at the next step or the next job — either way, the next
  // line at or below the step's own indentation that starts a new block.
  const end = rest.search(/\n {0,6}(- name:|[a-z-]+:\n)/)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('the deploy step is observable while it runs (AWTD-959)', () => {
  it('does not swallow vercel output in a command substitution', () => {
    // `X=$(vercel deploy ...)` is the exact pattern that produced 18 minutes of
    // blank log. Progress has to reach the runner as it happens.
    expect(deployStep()).not.toMatch(/=\$\(\s*(timeout[^)]*)?vercel deploy/)
  })

  it('streams the output to the log and keeps a copy to parse', () => {
    expect(deployStep()).toMatch(/\|\s*tee\b/)
  })

  it('sets pipefail, so a failing vercel behind a pipe is still a failure', () => {
    // Without it the pipeline's status is tee's, which is always 0.
    expect(deployStep()).toMatch(/set -o pipefail|set -eo pipefail|set -euo pipefail/)
  })
})

describe('the deploy step cannot eat the job budget (AWTD-959)', () => {
  it('wraps the vercel CLI in a real timeout', () => {
    expect(deployStep()).toMatch(/\btimeout\s+(--[a-z-]+\s+)*\d+[smh]?\s+vercel deploy/)
  })

  it('leaves the CLI timeout below the job timeout, so the step reports first', () => {
    const step = deployStep()
    const cliSeconds = Number(/\btimeout\s+(?:--[a-z-]+\s+)*(\d+)\s+vercel deploy/.exec(step)?.[1])
    expect(Number.isFinite(cliSeconds)).toBe(true)

    const job = source.slice(source.indexOf('deploy-production:'))
    const jobMinutes = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1])
    expect(Number.isFinite(jobMinutes)).toBe(true)

    // A runner cancellation is an `##[error]The operation was canceled.` with no
    // diagnosis. The step must get there first and say why.
    expect(cliSeconds).toBeLessThan(jobMinutes * 60)
  })
})

describe('success reflects what production is serving (AWTD-959)', () => {
  it('verifies the deployed commit rather than trusting the CLI stdout alone', () => {
    // /api/health reports VERCEL_GIT_COMMIT_SHA as `commitSha`. That is the one
    // answer production can give about whether this deploy landed, and on
    // 2026-09-18 it said 25712912 while the job said FAILED.
    expect(deployStep()).toMatch(/verify-deployed-sha\.sh/)
  })

  it('reuses the tested URL extractor instead of an inline regex', () => {
    // scripts/extract-preview-url.sh is pinned by
    // tests/scripts/extract-preview-url.test.ts and handles the cursor-control
    // escapes and the Inspect-URL trap the inline version missed.
    const step = deployStep()
    expect(step).toMatch(/extract-preview-url\.sh/)
    expect(step).not.toMatch(/grep -oE 'https:\/\//)
  })
})

describe('the health check is not deleted by a red deploy (AWTD-959)', () => {
  function healthCheckJob(): string {
    const start = source.indexOf('health-check:')
    expect(start).toBeGreaterThan(-1)
    const rest = source.slice(start)
    const end = rest.indexOf('\n  deployment-summary:')
    return end === -1 ? rest : rest.slice(0, end)
  }

  it('runs whenever the deploy was attempted, not only when it reported success', () => {
    const job = healthCheckJob()
    const condition = /if:\s*(.+)/.exec(job)?.[1] ?? ''

    expect(condition).toMatch(/always\(\)/)
    // The old gate was `needs.deploy-production.outputs.deployment-success == 'true'`,
    // which is exactly what skipped it during the outage.
    expect(condition).not.toMatch(/deployment-success == 'true'\s*$/)
  })

  it('checks the deployed commit, not just that a page returns 200', () => {
    // astrid.cc returned 200 throughout the outage while every list read 500'd,
    // so a home-page status code was never evidence that the deploy was good.
    expect(healthCheckJob()).toMatch(/verify-deployed-sha\.sh/)
  })
})

describe('destructive migrations are gated on the code being live (AWTD-959)', () => {
  function migrationJob(): string {
    const start = source.indexOf('database-migration:')
    const rest = source.slice(start)
    return rest.slice(0, rest.indexOf('\n  deploy-production:'))
  }

  it('guards pending migrations before applying them', () => {
    const job = migrationJob()
    expect(job).toMatch(/check-destructive-migrations/)

    const guardAt = job.indexOf('check-destructive-migrations')
    const applyAt = job.indexOf('prisma migrate deploy')
    expect(guardAt).toBeGreaterThan(-1)
    expect(applyAt).toBeGreaterThan(-1)
    // A guard that runs after the DROP has already happened is decoration.
    expect(guardAt).toBeLessThan(applyAt)
  })

  it('requires an explicit dispatch input to apply one anyway', () => {
    expect(source).toMatch(/allow_destructive_migrations:/)
    expect(migrationJob()).toMatch(/ALLOW_DESTRUCTIVE_MIGRATIONS/)
  })

  it('defaults that input to refusing', () => {
    const input = source.slice(source.indexOf('allow_destructive_migrations:'))
    const declaration = input.slice(0, input.indexOf('type:') + 20)
    expect(declaration).toMatch(/default:\s*false/)
  })
})
