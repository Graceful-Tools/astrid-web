/**
 * AWTD-1250 — what the loop may land and deploy without asking.
 *
 * Jon gave the permission conditionally: *"can deploy with clean tests and
 * monitor to make sure it works"*. These pin the conditions, because the cost
 * of getting them wrong is asymmetric — a missed deploy is a delay, a wrong one
 * is an outage, and one of the cases below took production down on 2026-09-18.
 */
import { describe, it, expect } from 'vitest'
import { resolvePolicy } from '@/lib/orchestration-policy'
import {
  astridFallbackPolicy,
  migrationKind,
  policyHold,
} from '@/scripts/lib/land-and-deploy'
import {
  carriesTaskId,
  deployedCompletionComment,
  deployLanded,
  deployRunOutcome,
  deployVerdict,
  landedDespiteError,
  landablePullRequests,
  migrationHold,
  pendingMigrations,
  summary,
  taskIdsInBranch,
  tasksProductionServes,
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
  files: [{ path: 'lib/auth/cookies.ts' }],
  ...over,
})

describe('only the loop’s own work is landable', () => {
  it('recognises a task id in a branch name', () => {
    expect(carriesTaskId('fix/awtd-1248-secure-cookie-over-http')).toBe(true)
    expect(carriesTaskId('AWTD-1039-blockers')).toBe(true)
    expect(carriesTaskId('dependabot/npm_and_yarn/prisma-7.10.0')).toBe(false)
    expect(carriesTaskId('feat/dark-mode')).toBe(false)
  })

  it('a moved task keeps its board prefix on an agent branch, and only there (2026-11-08)', () => {
    // "Non repeating tasks say 'never'" is AITD-582 on the web board (PR #663).
    expect(carriesTaskId('agent/claude-code/AITD-582-one-time-only-label')).toBe(true)
    expect(taskIdsInBranch('agent/claude-code/AITD-582-one-time-only-label')).toEqual(['AITD-582'])
    // The widening is anchored to the agent branch shape, so nothing else starts matching.
    expect(carriesTaskId('dependabot/npm_and_yarn/eslint-10')).toBe(false)
    expect(carriesTaskId('dependabot/npm_and_yarn/prisma-7.10.0')).toBe(false)
    expect(carriesTaskId('fix/aitd-582-label')).toBe(false)
    expect(carriesTaskId('agent/claude-code/fix-label')).toBe(false)
  })

  it('a moved task with a valid handoff is landable; without one it is not', () => {
    const moved = pr({ headRefName: 'agent/claude-code/AITD-582-one-time-only-label' })
    expect(landablePullRequests([{ ...moved, cloudHandoffValid: true }]).land).toHaveLength(1)
    expect(landablePullRequests([moved]).land).toHaveLength(0)
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

describe('ADEV-42: workflow changes wait for a human', () => {
  // Granting the cloud token the Workflows permission lets an agent PR edit CI,
  // including the deploy workflow and this ship bot. Those land only by hand.
  it('ADEV-42: holds back a PR that touches .github/workflows/', () => {
    const decision = landablePullRequests([pr({ files: [{ path: 'lib/x.ts' }, { path: '.github/workflows/production-deployment.yml' }] })])
    expect(decision.land).toHaveLength(0)
    expect(decision.skipped[0].why).toMatch(/\.github\/workflows\/production-deployment\.yml.*human/)
  })

  it('ADEV-42: holds back other .github/ files too (composite actions run inside workflows)', () => {
    expect(landablePullRequests([pr({ files: [{ path: '.github/actions/setup/action.yml' }] })]).land).toHaveLength(0)
  })

  it('ADEV-42: fails closed when the changed files were not read', () => {
    const decision = landablePullRequests([pr({ files: undefined })])
    expect(decision.land).toHaveLength(0)
    expect(decision.skipped[0].why).toMatch(/changed files/)
  })

  it('ADEV-42: fails closed at the 100-file cap gh pr list reports', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `lib/f${i}.ts` }))
    expect(landablePullRequests([pr({ files })]).land).toHaveLength(0)
  })

  it('ADEV-42: still lands an ordinary PR', () => {
    expect(landablePullRequests([pr({ files: [{ path: 'docs/github-workflows.md' }] })]).land).toHaveLength(1)
  })
})

describe('naming the PRs to land', () => {
  it('lands exactly the ones named, and says why the others were skipped', () => {
    // From a real mis-land on 2026-10-13: `--max-land 1`, intending to land
    // #420, landed #385 instead — the cap takes the first LANDABLE pr, and
    // #420 had a pending preview build at that moment, so another task's green
    // PR was chosen and deployed. A cap bounds how much ships, not which.
    const { land, skipped } = landablePullRequests(
      [pr({ number: 420 }), pr({ number: 385 })],
      { only: [420] },
    )
    expect(land.map(p => p.number)).toEqual([420])
    expect(skipped).toEqual([{ number: 385, why: 'not named by --pr' }])
  })

  it('lands everything landable when none is named — the unattended default', () => {
    const { land } = landablePullRequests([pr({ number: 420 }), pr({ number: 385 })])
    expect(land.map(p => p.number)).toEqual([420, 385])
  })

  it('still applies every other rule to a named PR', () => {
    // --pr says WHICH, never "ignore the checks".
    const { land } = landablePullRequests(
      [pr({ number: 420, checks: [...green, { name: 'e2e', bucket: 'fail' }] })],
      { only: [420] },
    )
    expect(land).toHaveLength(0)
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

  // AWTD-1680. Jon, 2026-11-15: additive migrations ship autonomously; only
  // destructive or data-rewriting ones wait for him. The loop used to stop on
  // ANY pending migration, which held every new table and nullable column.
  const additive = {
    name: '20261011150000_project_fields',
    sql: `-- adds two nullable columns
ALTER TABLE "TaskList" ADD COLUMN "projectGoal" TEXT;
CREATE INDEX "TaskList_projectGoal_idx" ON "TaskList"("projectGoal");`,
  }
  const drop = {
    name: '20260917120000_drop_tasklist_status_columns',
    sql: 'ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusRole";',
  }
  const rewrite = {
    name: '20261101000000_backfill_priority',
    sql: 'UPDATE "Task" SET "priority" = 0 WHERE "priority" IS NULL;',
  }

  it('AWTD-1680: deploys an additive-only pending set', () => {
    expect(deployVerdict({ ...base, pending: [additive] })).toEqual({ deploy: true })
  })

  it('AWTD-1680: stops with exit 3 for a pending DROP, naming the statement and the file', () => {
    // The migration job runs BEFORE the deploy. No test result makes a DROP
    // reversible, so "all tests green" does not license this one.
    const verdict = deployVerdict({ ...base, pending: [additive, drop] })
    expect(verdict).toMatchObject({ deploy: false, code: 3 })
    const reason = (verdict as { reason: string }).reason
    expect(reason).toContain('prisma/migrations/20260917120000_drop_tasklist_status_columns/migration.sql')
    expect(reason).toContain('DROP COLUMN')
    expect(reason).toContain('ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusRole"')
    expect(reason).not.toContain('20261011150000_project_fields')
    expect(reason).toMatch(/before the new code is live/)
  })

  it('AWTD-1680: stops with exit 3 for a pending data rewrite', () => {
    const verdict = deployVerdict({ ...base, pending: [rewrite] })
    expect(verdict).toMatchObject({ deploy: false, code: 3 })
    const reason = (verdict as { reason: string }).reason
    expect(reason).toContain('prisma/migrations/20261101000000_backfill_priority/migration.sql')
    expect(reason).toContain('UPDATE')
  })

  it('AWTD-1680: stops when a pending migration\'s SQL could not be read', () => {
    // A check that cannot establish safety must not report safety.
    const verdict = deployVerdict({ ...base, pending: [{ name: '20261102000000_mystery', sql: null }] })
    expect(verdict).toMatchObject({ deploy: false, code: 3 })
    expect((verdict as { reason: string }).reason).toContain('20261102000000_mystery')
  })

  it('AWTD-1680: migrationHold is null for additive sets and names the stop otherwise', () => {
    expect(migrationHold([])).toBeNull()
    expect(migrationHold([additive])).toBeNull()
    expect(migrationHold([additive, rewrite])).toMatch(/backfill_priority/)
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
      deployVerdict({ ...base, pending: [drop], predeployGreen: false }),
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

// AWTD-1278: a scheduled run leaves finished work incomplete with an
// `AWAITING-DEPLOY: <sha>` marker, because done means deployed. Something has
// to mark it done once production serves it, and the answer has to come from
// production, not from "a deploy ran".
describe('AWTD-1278: tasks awaiting a deploy are completed once production serves them', () => {
  const serving = 'ae92dd77bd0af6818d377785ecd58ee28f88e756'
  const awaiting = [
    { id: 't1', identifier: 'AWTD-839', sha: '1111111aaaa' },
    { id: 't2', identifier: 'AWTD-1278', sha: '2222222bbbb' },
  ]
  // Only t1's commit is in what production serves.
  const contains = (commit: string, tip: string) => tip === serving && commit === '1111111aaaa'

  it('AWTD-1278: completes exactly the tasks whose commit production serves', () => {
    expect(tasksProductionServes({ servingSha: serving, awaiting, contains }).map(t => t.identifier)).toEqual([
      'AWTD-839',
    ])
  })

  it('AWTD-1278: completes nothing when production does not say what it serves', () => {
    expect(tasksProductionServes({ servingSha: null, awaiting, contains: () => true })).toEqual([])
  })

  it('AWTD-1278: the completion comment names what production serves', () => {
    const text = deployedCompletionComment({ sha: '1111111aaaa', servingSha: serving })
    expect(text).toContain('1111111a')
    expect(text).toContain('ae92dd77')
    // Not a marker line, so it cannot be mistaken for a new condition.
    expect(text).not.toMatch(/^\s*AWAITING-DEPLOY:/im)
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

  it('AWTD-1429: a dry run says what it would deploy, never that it deployed', () => {
    // A dry run sets verified so the run reads as clean, but nothing went out.
    // Saying "deployed … Production is serving" here reported a deploy that
    // never happened while production still served the previous commit.
    const text = summary({
      landed: [],
      skipped: [],
      verdict: { deploy: true },
      sha: '54329b51fc67d5e3',
      verified: true,
      dryRun: true,
    })
    expect(text).toMatch(/would deploy `54329b51`/i)
    expect(text).not.toMatch(/\bdeployed\b/i)
    expect(text).not.toMatch(/Production is serving/i)
  })

  it('AWTD-1278: names the tasks it marked complete because production serves them', () => {
    const text = summary({
      landed: [],
      skipped: [],
      verdict: { deploy: false, code: 0, reason: 'nothing new to deploy' },
      completedTasks: ['AWTD-839', 'AWTD-1278'],
    })
    expect(text).toContain('AWTD-839, AWTD-1278')
    expect(text).toMatch(/complete/i)
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

// ADEV-20: Astrid's own runner reads the stored orchestration policy instead of carrying its own rules.
describe('ADEV-20: the runner asks the stored policy', () => {
  const additive = { name: '20261011150000_x', sql: 'ALTER TABLE "T" ADD COLUMN "a" TEXT;' }
  const drop = { name: '20260917120000_y', sql: 'ALTER TABLE "T" DROP COLUMN "a";' }
  const astrid = astridFallbackPolicy()
  const ask = (autonomy: object) => resolvePolicy({ autonomy } as never, null)

  it('ADEV-20: the fallback policy is the core fixture: merge, deploy and additive allowed', () => {
    expect(astrid.autonomy.merge).toBe('allowed')
    expect(astrid.autonomy.deploy).toBe('allowed')
    expect(astrid.autonomy.migrate.additive).toBe('allowed')
    expect(astrid.autonomy.migrate.destructive).toBe('ask')
  })

  it('ADEV-20: classifies pending migrations', () => {
    expect(migrationKind([])).toBeNull()
    expect(migrationKind([additive])).toBe('additive')
    expect(migrationKind([additive, drop])).toBe('destructive')
    expect(migrationKind([{ name: 'z', sql: null }])).toBe('destructive')
  })

  it('ADEV-20: policyHold is null when allowed and names the answer when ask or never', () => {
    expect(policyHold(astrid, 'claude', 'merge')).toBeNull()
    expect(policyHold(ask({ merge: 'ask' }), 'claude', 'merge')).toMatch(/ask/)
    expect(policyHold(ask({ deploy: 'never' }), 'claude', 'deploy')).toMatch(/never/)
  })

  it('ADEV-20: migrate.additive ask holds an additive migration with exit 3', () => {
    const policy = ask({ deploy: 'allowed', migrate: { additive: 'ask' } })
    const verdict = deployVerdict({ landedOrAlreadyOnMain: true, pending: [additive], predeployGreen: true, policy, agent: 'claude' })
    expect(verdict).toMatchObject({ deploy: false, code: 3, approval: 'migrate' })
  })

  it('ADEV-20: putting it back ships the additive migration', () => {
    const verdict = deployVerdict({ landedOrAlreadyOnMain: true, pending: [additive], predeployGreen: true, policy: astrid, agent: 'claude' })
    expect(verdict).toEqual({ deploy: true })
  })

  it('ADEV-20: deploy ask holds a code-only change; the red gate rule is unchanged', () => {
    const policy = ask({ deploy: 'ask' })
    expect(deployVerdict({ landedOrAlreadyOnMain: true, pending: [], predeployGreen: true, policy, agent: 'claude' }))
      .toMatchObject({ deploy: false, code: 3, approval: 'deploy' })
    expect(deployVerdict({ landedOrAlreadyOnMain: true, pending: [], predeployGreen: false, policy: astrid, agent: 'claude' }))
      .toMatchObject({ deploy: false, code: 4 })
  })

  it('ADEV-20: a destructive migration still holds even if a policy allowed it', () => {
    const policy = ask({ migrate: { additive: 'allowed', destructive: 'allowed' } })
    expect(deployVerdict({ landedOrAlreadyOnMain: true, pending: [drop], predeployGreen: true, policy, agent: 'claude' }))
      .toMatchObject({ deploy: false, code: 3 })
  })
})

describe('ADEV-268: a deploy that is still running is not a failed deploy', () => {
  it('classifies an in-progress or queued run as running, whatever its empty conclusion says', () => {
    for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
      expect(deployRunOutcome({ status, conclusion: '', jobs: [{ name: 'Database Migration', conclusion: '' }] }))
        .toEqual({ state: 'running' })
    }
  })

  it('classifies a completed green run as succeeded', () => {
    expect(deployRunOutcome({ status: 'completed', conclusion: 'success', jobs: [] })).toEqual({ state: 'succeeded' })
  })

  it('names the failed jobs of a completed red run, skipping green and skipped ones', () => {
    expect(deployRunOutcome({
      status: 'completed',
      conclusion: 'failure',
      jobs: [
        { name: 'Quality Gates', conclusion: 'failure' },
        { name: 'Deploy to Production', conclusion: 'skipped' },
        { name: 'Summary', conclusion: 'success' },
      ],
    })).toEqual({ state: 'failed', failed: ['Quality Gates'] })
  })

  it('falls back to the run conclusion when no job carries the failure', () => {
    expect(deployRunOutcome({ status: 'completed', conclusion: 'cancelled', jobs: [] }))
      .toEqual({ state: 'failed', failed: ['run cancelled'] })
  })

  it('reports a still-running deploy as running, never as FAILED or unchanged (run 45644585316)', () => {
    const text = summary({
      landed: [987],
      skipped: [],
      verdict: { deploy: true },
      sha: 'a486ef67',
      runUrl: 'https://github.com/x/y/actions/runs/45644889204',
      verified: false,
      runStillRunning: true,
    })
    expect(text).toMatch(/still running/i)
    expect(text).toContain('45644889204')
    expect(text).not.toMatch(/FAILED/)
    expect(text).not.toMatch(/production is unchanged/i)
    expect(text).not.toMatch(/could NOT verify/)
  })
})
