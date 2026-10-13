/**
 * AWTD-1250 — what the loop may land and deploy without asking.
 *
 * Jon gave the permission conditionally: *"can deploy with clean tests and
 * monitor to make sure it works"*. These pin the conditions, because the cost
 * of getting them wrong is asymmetric — a missed deploy is a delay, a wrong one
 * is an outage, and one of the cases below took production down on 2026-09-18.
 */
import { describe, it, expect } from 'vitest'
import {
  carriesTaskId,
  deployLanded,
  deployVerdict,
  landedDespiteError,
  landablePullRequests,
  pendingMigrations,
  summary,
  taskIdsInBranch,
  type PullRequestSummary,
} from '@/scripts/lib/land-and-deploy'

const green = [
  { name: 'Build & Test PR', bucket: 'pass' },
  { name: 'authenticated-critical', bucket: 'pass' },
  { name: 'auto-merge', bucket: 'skipping' },
]

const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 418,
  headRefName: 'fix/awtd-1248-secure-cookie-over-http',
  body: 'Opened by the runner (`scripts/open-fixall-prs.ts`) because a scheduled session cannot run `gh`.',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  checks: green,
  ...over,
})

describe('only the loop’s own work is landable', () => {
  it('recognises a task id in a branch name', () => {
    expect(carriesTaskId('fix/awtd-1248-secure-cookie-over-http')).toBe(true)
    expect(carriesTaskId('AWTD-1039-blockers')).toBe(true)
    expect(carriesTaskId('dependabot/npm_and_yarn/prisma-7.10.0')).toBe(false)
    expect(carriesTaskId('feat/dark-mode')).toBe(false)
  })

  it('reads the ids out of the branch', () => {
    expect(taskIdsInBranch('fix/awtd-1039-and-awtd-1248')).toEqual(['AWTD-1039', 'AWTD-1248'])
    expect(taskIdsInBranch('feat/none')).toEqual([])
  })

  it('lands only PRs the runner itself opened', () => {
    // A task id in the branch is not enough. When this shipped, eight
    // `fix/awtd-*` PRs were open from runs that predate the deploy permission,
    // and Jon may have left any of them open on purpose. The marker is the
    // line open-fixall-prs.ts writes into every PR it opens.
    const { land, skipped } = landablePullRequests([
      pr(),
      pr({ number: 383, body: 'Hand-written PR about the same task area.' }),
    ])
    expect(land.map(p => p.number)).toEqual([418])
    expect(skipped[0].why).toMatch(/not opened by the runner/)
  })

  it('can be told not to require the marker, for an interactive run', () => {
    // An interactive /fixall opens its own PRs with `gh` and lands its own
    // work; the marker check is the unattended runner's safeguard.
    const { land } = landablePullRequests([pr({ body: 'opened by hand' })], {
      requireRunnerMarker: false,
    })
    expect(land).toHaveLength(1)
  })

  it('leaves other people’s branches alone', () => {
    // Ten Dependabot majors sit open on this repo for weeks. An agent merging
    // one is an agent landing a change nobody asked it to land.
    const { land, skipped } = landablePullRequests([
      pr(),
      pr({ number: 296, headRefName: 'dependabot/npm_and_yarn/prisma-7.10.0' }),
    ])
    expect(land.map(p => p.number)).toEqual([418])
    expect(skipped[0]).toMatchObject({ number: 296 })
    expect(skipped[0].why).toMatch(/not the loop's work/)
  })
})

describe('a PR has to be actually green', () => {
  it('lands a clean, mergeable, fully-passing PR', () => {
    expect(landablePullRequests([pr()]).land).toHaveLength(1)
  })

  it('treats pending checks as a wait, not a refusal', () => {
    // The runner opens a PR and its CI takes ~10 minutes. Waiting in-process
    // would burn the run's watchdog; the next tick lands it.
    const { land, skipped } = landablePullRequests([
      pr({ checks: [...green, { name: 'E2E Tests on Preview', bucket: 'pending' }] }),
    ])
    expect(land).toHaveLength(0)
    expect(skipped[0].why).toMatch(/still running/)
    expect(skipped[0].why).toMatch(/next tick/)
  })

  it('refuses a red check and names it', () => {
    const { land, skipped } = landablePullRequests([
      pr({ checks: [...green, { name: 'authenticated-critical', bucket: 'fail' }] }),
    ])
    expect(land).toHaveLength(0)
    expect(skipped[0].why).toMatch(/red: authenticated-critical/)
  })

  it('refuses a cancelled check — a cancel is not a pass', () => {
    const { land } = landablePullRequests([
      pr({ checks: [{ name: 'Build & Test PR', bucket: 'cancel' }] }),
    ])
    expect(land).toHaveLength(0)
  })

  it('refuses a PR no check has reported on', () => {
    // An empty list is not green. It is a PR whose CI never ran, which is
    // exactly how a red gate goes unnoticed.
    const { land, skipped } = landablePullRequests([pr({ checks: [] })])
    expect(land).toHaveLength(0)
    expect(skipped[0].why).toMatch(/no check has reported/)
  })

  it('refuses a PR that is only skips, with nothing actually passing', () => {
    const { land } = landablePullRequests([
      pr({ checks: [{ name: 'auto-merge', bucket: 'skipping' }] }),
    ])
    expect(land).toHaveLength(0)
  })

  it('waits rather than refuses when GitHub has not computed mergeability', () => {
    // The dry run on 2026-10-13 held back eight PRs as "not mergeable
    // (UNKNOWN)". GitHub computes this lazily: the first query after a push
    // answers UNKNOWN, a later one answers properly. Reading that as a refusal
    // would hold a mergeable PR back for ever.
    const { land, skipped } = landablePullRequests([pr({ mergeable: 'UNKNOWN' })])
    expect(land).toHaveLength(0)
    expect(skipped[0].why).toMatch(/not computed yet/)
    expect(skipped[0].why).toMatch(/next tick/)
  })

  it('respects what GitHub is holding back', () => {
    for (const state of ['DIRTY', 'BEHIND', 'BLOCKED', 'UNSTABLE']) {
      const { land, skipped } = landablePullRequests([pr({ mergeStateStatus: state })])
      expect(land, state).toHaveLength(0)
      expect(skipped[0].why, state).toContain(state)
    }
    expect(landablePullRequests([pr({ mergeable: 'CONFLICTING' })]).land).toHaveLength(0)
  })

  it('leaves a draft alone', () => {
    expect(landablePullRequests([pr({ isDraft: true })]).land).toHaveLength(0)
  })
})

describe('a merge that GitHub accepted counts as landed', () => {
  it('reads the PR state, not the exit code', () => {
    // This script's own first real run, 2026-10-13: `gh pr merge
    // --delete-branch` merged #419 server-side, then failed doing local git
    // work on a dirty tree ("Your local changes … would be overwritten by
    // checkout"). The non-zero exit said failure about an already-merged PR,
    // so the run reported "could not land #419" and deployed that very merge
    // moments later. Unattended, a deploy goes out while the chat says nothing
    // landed — which is why the exit code is no longer trusted.
    expect(landedDespiteError('MERGED')).toBe(true)
    expect(landedDespiteError('OPEN')).toBe(false)
    expect(landedDespiteError('CLOSED')).toBe(false)
    expect(landedDespiteError(undefined)).toBe(false)
  })
})

describe('pending migrations are read from the prod..main diff', () => {
  it('names each migration directory once', () => {
    const diff = [
      'prisma/migrations/20261011150000_project_fields/migration.sql',
      'prisma/migrations/20261011170000_task_previous_occurrence/migration.sql',
      'prisma/migrations/20261011170000_task_previous_occurrence/README.md',
    ].join('\n')
    expect(pendingMigrations(diff)).toEqual([
      '20261011150000_project_fields',
      '20261011170000_task_previous_occurrence',
    ])
  })

  it('is empty for a code-only deploy', () => {
    expect(pendingMigrations('')).toEqual([])
    expect(pendingMigrations('\n  \n')).toEqual([])
  })

  it('ignores the lock file, which is not a migration', () => {
    expect(pendingMigrations('prisma/migrations/migration_lock.toml')).toEqual([])
  })
})

describe('the verdict before production changes', () => {
  const base = { landedOrAlreadyOnMain: true, pending: [], predeployGreen: true }

  it('deploys a green, code-only change', () => {
    expect(deployVerdict(base)).toEqual({ deploy: true })
  })

  it('stops for a pending migration, however green the tests are', () => {
    // The migration job runs BEFORE the deploy. No test result makes a DROP
    // reversible, so "all tests green" does not license this one.
    const verdict = deployVerdict({ ...base, pending: ['20261011150000_project_fields'] })
    expect(verdict).toMatchObject({ deploy: false, code: 3 })
    expect((verdict as { reason: string }).reason).toContain('20261011150000_project_fields')
    expect((verdict as { reason: string }).reason).toMatch(/before the new code is live/)
  })

  it('stops on a red gate', () => {
    expect(deployVerdict({ ...base, predeployGreen: false })).toMatchObject({
      deploy: false,
      code: 4,
    })
  })

  it('prefers the migration stop over the red-gate stop', () => {
    // Both are stops; the report should name the one that cannot be undone.
    expect(
      deployVerdict({ ...base, pending: ['x_drop_columns'], predeployGreen: false }),
    ).toMatchObject({ code: 3 })
  })

  it('does nothing, quietly, when there is nothing new', () => {
    expect(deployVerdict({ ...base, landedOrAlreadyOnMain: false })).toMatchObject({
      deploy: false,
      code: 0,
    })
  })

  it('calls a quiet tick quiet, not red', () => {
    // A tick with nothing to ship never runs predeploy, so predeployGreen is
    // false for want of asking. Reported as a red gate, that is a false alarm
    // on every idle tick — which is what the first dry run printed.
    const verdict = deployVerdict({
      landedOrAlreadyOnMain: false,
      pending: [],
      predeployGreen: false,
    })
    expect(verdict).toMatchObject({ deploy: false, code: 0 })
    expect((verdict as { reason: string }).reason).toMatch(/nothing new/)
  })

  it('never lets the loop pass allow_destructive_migrations', () => {
    expect(deployVerdict({ ...base, allowDestructive: true })).toMatchObject({
      deploy: false,
      code: 2,
    })
  })
})

describe('the deploy is verified against what production serves', () => {
  const sha = 'ae92dd77bd0af6818d377785ecd58ee28f88e756'

  it('agrees when production serves the deployed commit', () => {
    expect(deployLanded({ expectedSha: sha, servingSha: sha })).toEqual({ ok: true })
  })

  it('compares a short sha on its own width', () => {
    expect(deployLanded({ expectedSha: 'ae92dd77', servingSha: sha }).ok).toBe(true)
  })

  it('fails when production serves something else, and says both', () => {
    const result = deployLanded({ expectedSha: sha, servingSha: '13585fa9ad5392d031afc85ec' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('13585fa9')
    expect(result.reason).toContain('ae92dd77')
  })

  it('fails when production answers with no sha at all', () => {
    expect(deployLanded({ expectedSha: sha, servingSha: null }).ok).toBe(false)
  })
})

describe('the news posted to the list chat', () => {
  it('says what landed and what production serves', () => {
    const text = summary({
      landed: [417, 418],
      skipped: [],
      verdict: { deploy: true },
      sha: 'ae92dd77bd0af',
      runUrl: 'https://github.com/x/y/actions/runs/1',
      verified: true,
    })
    expect(text).toMatch(/deployed to production/)
    expect(text).toContain('#417, #418')
    expect(text).toContain('ae92dd77')
  })

  it('does not report an outage when the run failed and nothing deployed', () => {
    // `deploy-production` needs quality-gates to have passed, so a red gate
    // means the deploy job never ran and production is untouched. Calling that
    // "deployed and could not verify" would describe an outage that is not
    // happening, and send someone looking for one.
    const text = summary({
      landed: [419],
      skipped: [],
      verdict: { deploy: true },
      sha: 'abc12345',
      runUrl: 'https://github.com/x/y/actions/runs/2',
      verified: false,
      runFailed: ['Quality Gates'],
    })
    expect(text).toMatch(/production is unchanged/i)
    expect(text).toContain('Quality Gates')
    expect(text).not.toMatch(/Check before trusting the site/)
  })

  it('is loud when the deploy went out but could not be verified', () => {
    const text = summary({
      landed: [418],
      skipped: [],
      verdict: { deploy: true },
      sha: 'ae92dd77',
      verified: false,
    })
    expect(text).toMatch(/could NOT verify/)
    expect(text).toMatch(/Check before trusting the site/)
  })

  it('gives the reason when it did not deploy', () => {
    const text = summary({
      landed: [],
      skipped: [],
      verdict: { deploy: false, code: 3, reason: 'pending migration(s) … — Jon’s call' },
    })
    expect(text).toMatch(/did NOT deploy/)
    expect(text).toMatch(/pending migration/)
  })

  it('lists what was held back, but not the routine waits', () => {
    const text = summary({
      landed: [],
      skipped: [
        { number: 296, why: "not the loop's work (dependabot/x)" },
        { number: 419, why: 'checks still running (3) — the next tick can land it' },
        { number: 420, why: 'red: authenticated-critical' },
      ],
      verdict: { deploy: false, code: 0, reason: 'nothing new to deploy' },
    })
    expect(text).toContain('#420')
    expect(text).not.toContain('#296')
    expect(text).not.toContain('#419')
  })
})
