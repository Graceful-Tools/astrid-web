/**
 * The decisions behind `scripts/land-and-deploy.ts` (AWTD-1250).
 *
 * Jon, 2026-10-13: *"Interactive sessions and automatic can deploy with clean
 * tests and monitor to make sure it works. Don't block on me."* An interactive
 * `/fixall` can run `gh` and does this itself. A scheduled `claude -p` session
 * cannot — `gh` is denied inside it — so the runner lands and deploys after the
 * run, the same arrangement that opens the PRs (`scripts/open-fixall-prs.ts`).
 *
 * Everything that decides whether production changes lives here, as pure
 * functions over already-fetched data, so it can be tested without a network,
 * a git checkout, or a deploy. The executable is the shell around it.
 */

/** A pull request as `gh pr list --json` reports it, plus its checks. */
export interface PullRequestSummary {
  number: number
  headRefName: string
  title?: string
  body?: string
  isDraft?: boolean
  mergeable?: string
  mergeStateStatus?: string
  /** `gh pr checks --json name,bucket`: pass | fail | pending | skipping | cancel. */
  checks?: Array<{ name: string; bucket: string }>
}

/**
 * The line `scripts/open-fixall-prs.ts` writes into every PR it opens.
 *
 * This is what makes auto-landing safe to switch on in a repo that already has
 * twenty open PRs. A task id in the branch name is not enough: eight branches
 * named `fix/awtd-*` were open when this shipped, from runs that predate the
 * deploy permission, and Jon may have left any of them open on purpose. Only a
 * PR the runner itself opened is the runner's to land.
 */
export const RUNNER_PR_MARKER = 'scripts/open-fixall-prs.ts'

export interface LandDecision {
  land: PullRequestSummary[]
  skipped: Array<{ number: number; why: string }>
}

/** Buckets that are not a failure and not a wait. */
const BENIGN_BUCKETS = new Set(['pass', 'skipping', 'neutral'])

/**
 * Does this branch carry a task id?
 *
 * The gate that keeps this script to the loop's OWN work. Ten Dependabot major
 * bumps and a dozen human branches are open on this repo at any time; none of
 * them is this script's business, and a merge of one would be an agent landing
 * a change nobody asked it to land. Matched the same way
 * `branchesForCompletedTask` matches, whole id only, so `awtd-12` is not
 * `awtd-125`.
 */
export function carriesTaskId(branch: string): boolean {
  return /(^|[^0-9a-z])awtd-(\d+)([^0-9]|$)/i.test(branch)
}

/** The task ids a branch names, uppercased, in the order they appear. */
export function taskIdsInBranch(branch: string): string[] {
  return [...branch.matchAll(/awtd-(\d+)/gi)].map(match => `AWTD-${match[1]}`)
}

/**
 * Which open PRs may be landed without a human.
 *
 * Deliberately strict, and every clause has a reason:
 *
 * - **a task id in the branch** — only the loop's own work (above).
 * - **not a draft** — a draft is an explicit "not yet".
 * - **MERGEABLE / CLEAN** — `DIRTY` means conflicts, and `BEHIND` or `BLOCKED`
 *   means a required check or review has not been satisfied. Landing either
 *   would be forcing something GitHub is holding back.
 * - **every check benign, at least one passing** — `pending` is the common case
 *   for a PR the runner opened minutes ago, and it is a *wait*, not a refusal:
 *   the next tick lands it. An empty check list is NOT green; it is a PR whose
 *   CI has not reported at all, which is how a red gate goes unnoticed.
 */
export function landablePullRequests(
  prs: PullRequestSummary[],
  options: { requireRunnerMarker?: boolean } = {},
): LandDecision {
  const requireMarker = options.requireRunnerMarker ?? true
  const land: PullRequestSummary[] = []
  const skipped: Array<{ number: number; why: string }> = []

  for (const pr of prs) {
    const checks = pr.checks ?? []
    const failing = checks.filter(check => check.bucket === 'fail' || check.bucket === 'cancel')
    const pending = checks.filter(check => check.bucket === 'pending')
    const passing = checks.filter(check => check.bucket === 'pass')

    if (!carriesTaskId(pr.headRefName)) {
      skipped.push({ number: pr.number, why: `not the loop's work (${pr.headRefName})` })
    } else if (requireMarker && !(pr.body ?? '').includes(RUNNER_PR_MARKER)) {
      skipped.push({ number: pr.number, why: 'not opened by the runner — a human merges this one' })
    } else if (pr.isDraft) {
      skipped.push({ number: pr.number, why: 'draft' })
    } else if (pr.mergeable === 'UNKNOWN') {
      // GitHub computes mergeability lazily; the first query after a push
      // answers UNKNOWN and a later one answers properly. Treating it as a
      // refusal would permanently hold back a perfectly mergeable PR.
      skipped.push({
        number: pr.number,
        why: 'mergeability not computed yet — the next tick can land it',
      })
    } else if (pr.mergeable && pr.mergeable !== 'MERGEABLE') {
      skipped.push({ number: pr.number, why: `not mergeable (${pr.mergeable})` })
    } else if (pr.mergeStateStatus && pr.mergeStateStatus !== 'CLEAN') {
      skipped.push({ number: pr.number, why: `merge state ${pr.mergeStateStatus}` })
    } else if (failing.length) {
      skipped.push({
        number: pr.number,
        why: `red: ${failing.map(check => check.name).join(', ')}`,
      })
    } else if (pending.length) {
      skipped.push({
        number: pr.number,
        why: `checks still running (${pending.length}) — the next tick can land it`,
      })
    } else if (!passing.length) {
      skipped.push({ number: pr.number, why: 'no check has reported yet' })
    } else if (checks.some(check => !BENIGN_BUCKETS.has(check.bucket))) {
      const odd = checks.filter(check => !BENIGN_BUCKETS.has(check.bucket))
      skipped.push({
        number: pr.number,
        why: `unrecognised check state: ${odd.map(c => `${c.name}=${c.bucket}`).join(', ')}`,
      })
    } else {
      land.push(pr)
    }
  }

  return { land, skipped }
}

/**
 * Migration files waiting to be applied, from
 * `git diff --name-only origin/prod origin/main -- prisma/migrations/`.
 *
 * `origin/prod` is what production is serving — only a successful deploy moves
 * it (`scripts/advance-prod-branch.sh`) — so this diff is exactly "what the
 * next deploy would apply".
 *
 * WHY THIS IS A STOP AND NOT A WARNING. `database-migration` runs BEFORE
 * `deploy-production` and does not depend on it, so a `DROP` lands while the
 * code that stops reading the dropped thing is still pending. On 2026-09-18
 * four TaskList columns dropped, the deploy hung and was cancelled, and the old
 * build 500'd on every list read — a DROP cannot be undone by redeploying. No
 * amount of green tests makes that reversible, which is why "all tests green"
 * does not license it.
 */
export function pendingMigrations(diffOutput: string): string[] {
  const dirs = new Set<string>()
  for (const line of diffOutput.split('\n')) {
    const path = line.trim()
    if (!path) continue
    const match = /^prisma\/migrations\/([^/]+)\//.exec(path)
    if (match && match[1] !== 'migration_lock.toml') dirs.add(match[1])
  }
  return [...dirs].sort()
}

export type DeployVerdict =
  | { deploy: true }
  | { deploy: false; code: number; reason: string }

/**
 * The last gate before production changes.
 *
 * Ordered by how expensive the mistake is, not by how likely: a migration that
 * cannot be undone outranks a red gate that can simply be fixed, and both
 * outrank having nothing to ship.
 */
export function deployVerdict(input: {
  landedOrAlreadyOnMain: boolean
  pending: string[]
  predeployGreen: boolean
  allowDestructive?: boolean
}): DeployVerdict {
  if (input.allowDestructive) {
    // There is no code path that should set this. It exists so that if one is
    // ever added, it fails here rather than in production.
    return {
      deploy: false,
      code: 2,
      reason:
        'allow_destructive_migrations is never set by the loop — a human states, on the record, that the code is already live',
    }
  }
  if (input.pending.length) {
    return {
      deploy: false,
      code: 3,
      reason: `pending migration(s) apply during the deploy, before the new code is live: ${input.pending.join(', ')} — Jon's call`,
    }
  }
  // Before the gate, deliberately. A tick with nothing to ship does not run
  // predeploy at all, so `predeployGreen` is false for want of asking — and
  // reporting that as "the gate is red" would be a false alarm on every quiet
  // tick. The dry run said exactly that before this was reordered.
  if (!input.landedOrAlreadyOnMain) {
    return { deploy: false, code: 0, reason: 'nothing new to deploy' }
  }
  if (!input.predeployGreen) {
    return { deploy: false, code: 4, reason: 'predeploy is red on the merged main' }
  }
  return { deploy: true }
}

/**
 * Did production end up serving the commit we deployed?
 *
 * The CLI's own exit code is not this answer. On 2026-09-18 the job reported
 * FAILED about a deploy that had gone out, and the health check — `needs:` that
 * job — was skipped on the one run where production was actually down. So the
 * question is asked of production, and a mismatch is a failure even when every
 * step above it was green.
 */
export function deployLanded(input: {
  expectedSha: string
  servingSha: string | null
}): { ok: boolean; reason?: string } {
  if (!input.servingSha) return { ok: false, reason: 'production did not report a commitSha' }
  if (!input.expectedSha) return { ok: false, reason: 'no expected sha to compare against' }
  // /api/health reports the full sha; compare on the shorter of the two so a
  // caller passing a short sha is not told production is wrong.
  const width = Math.min(input.expectedSha.length, input.servingSha.length, 40)
  if (input.expectedSha.slice(0, width) !== input.servingSha.slice(0, width)) {
    return {
      ok: false,
      reason: `production is serving ${input.servingSha.slice(0, 8)}, expected ${input.expectedSha.slice(0, 8)}`,
    }
  }
  return { ok: true }
}

/** The run news, for the list chat. One place, so the wording cannot drift. */
export function summary(input: {
  landed: number[]
  skipped: Array<{ number: number; why: string }>
  verdict: DeployVerdict
  sha?: string
  runUrl?: string
  verified?: boolean
  dryRun?: boolean
  deferred?: number[]
  /** Jobs that failed in the dispatched run, if it did not succeed. */
  runFailed?: string[]
}): string {
  const lines: string[] = []
  const verb = input.dryRun ? 'Would land' : 'Landed'
  const landed = input.landed.length
    ? `${verb} ${input.landed.map(n => `#${n}`).join(', ')}.`
    : 'Nothing was landable this tick.'

  if (input.verdict.deploy && !input.verified && input.runFailed?.length) {
    // Nothing reached production: `deploy-production` needs quality-gates to
    // have passed, so a red gate means the deploy job never ran. Saying
    // "deployed and could not verify" here would describe an outage that is
    // not happening.
    lines.push(`**Scheduled /fixall (web): the deploy run FAILED — production is unchanged.** ${landed}`)
    lines.push(
      `Failed: ${input.runFailed.join(', ')}${input.runUrl ? ` (${input.runUrl})` : ''}. ` +
        'Production is still serving what it served before.',
    )
  } else if (input.verdict.deploy && input.verified) {
    lines.push(`**Scheduled /fixall (web) deployed to production.** ${landed}`)
    lines.push(
      `Production is serving \`${(input.sha ?? '').slice(0, 8)}\`${input.runUrl ? ` (${input.runUrl})` : ''}.`,
    )
  } else if (input.verdict.deploy) {
    lines.push(`**Scheduled /fixall (web) deployed, and could NOT verify it.** ${landed}`)
    lines.push(
      `Expected production to serve \`${(input.sha ?? '').slice(0, 8)}\`${input.runUrl ? ` (${input.runUrl})` : ''} — it does not. Check before trusting the site.`,
    )
  } else if (input.verdict.code === 0) {
    lines.push(`**Scheduled /fixall (web): nothing to deploy.** ${landed}`)
  } else {
    lines.push(`**Scheduled /fixall (web) did NOT deploy.** ${landed}`)
    lines.push(input.verdict.reason)
  }

  if (input.deferred?.length) {
    lines.push('')
    lines.push(
      `Also green and waiting: ${input.deferred.map(n => `#${n}`).join(', ')} — left for the next tick so one deploy stays reviewable.`,
    )
  }

  const held = input.skipped.filter(s => !/next tick|not the loop/.test(s.why))
  if (held.length) {
    lines.push('')
    lines.push('Held back:')
    for (const skip of held) lines.push(`- #${skip.number} — ${skip.why}`)
  }

  return lines.join('\n')
}
