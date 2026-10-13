#!/usr/bin/env npx tsx
/**
 * Land this loop's green PRs and deploy `main` to production (AWTD-1250).
 *
 * Jon, 2026-10-13: *"Interactive sessions and automatic can deploy with clean
 * tests and monitor to make sure it works. Don't block on me."*
 *
 * `gh` is denied inside a scheduled `claude -p` session, so the session cannot
 * dispatch a workflow any more than it can open a PR. The runner calls this
 * after the run, next to `scripts/open-fixall-prs.ts`.
 *
 * It lands PRs from PREVIOUS runs, not the one just opened: a fresh PR's checks
 * take about ten minutes, and a loop that waited would spend its watchdog on CI.
 *
 * Usage:
 *   npx tsx scripts/land-and-deploy.ts [--repo <path>] [--list-id <id>]
 *                                      [--dry-run] [--gate] [--max-land <n>]
 *                                      [--include-hand-opened]
 *
 * Exit codes — chosen so the caller can tell "did not" from "could not":
 *   0  deployed and verified, or nothing to do
 *   2  refused: allow_destructive_migrations (never set by the loop)
 *   3  did not deploy: a pending migration needs a human
 *   4  did not deploy: the gate is red on the merged main
 *   5  deployed and could NOT verify production is serving it
 *   1  something broke (git, gh, network)
 *
 * The decisions live in scripts/lib/land-and-deploy.ts and are unit-tested in
 * tests/scripts/land-and-deploy.test.ts. This file is the shell: it gathers
 * facts, applies them, and reports.
 */

import { execFileSync } from 'child_process'
import {
  RUNNER_PR_MARKER,
  carriesTaskId,
  deployLanded,
  landedDespiteError,
  deployVerdict,
  landablePullRequests,
  pendingMigrations,
  summary,
  type PullRequestSummary,
} from './lib/land-and-deploy'

const WORKFLOW = 'production-deployment.yml'
const HEALTH_URL = 'https://astrid.cc/api/health'

interface Options {
  repo: string
  listId: string | null
  dryRun: boolean
  gate: boolean
  maxLand: number
  includeHandOpened: boolean
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? null : argv[index + 1] ?? null
  }
  return {
    repo: value('--repo') ?? process.cwd(),
    listId: value('--list-id'),
    dryRun: argv.includes('--dry-run'),
    gate: argv.includes('--gate'),
    // One deploy carries everything landed in the same tick, so a big batch is
    // a big deploy. Capped so the first tick after this shipped does not land a
    // backlog of green runner PRs at once; the rest go on the next tick.
    maxLand: Number(value('--max-land') ?? 5),
    // The runner-marker check is the UNATTENDED safeguard: it keeps a tick from
    // landing a PR a human opened and may be holding open on purpose. An
    // interactive run owns its own PR and can say so.
    includeHandOpened: argv.includes('--include-hand-opened'),
  }
}

const options = parseArgs(process.argv.slice(2))

/** Run a command, returning stdout. Throws with the output on failure. */
function run(command: string, args: string[], timeoutMs = 120_000): string {
  return execFileSync(command, args, {
    cwd: options.repo,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  }).toString()
}

/** Run a command for its exit status only. */
function succeeds(command: string, args: string[], timeoutMs = 600_000): boolean {
  try {
    execFileSync(command, args, {
      cwd: options.repo,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

const log = (line: string) => console.log(line)

/** Tidy up the merged branch. Best effort: a leftover branch harms nothing. */
function deleteRemoteBranch(branch: string): void {
  try {
    run('gh', ['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${branch}`])
  } catch {
    // Already gone (the repo may delete on merge), or protected. Either is fine.
  }
}

async function servingSha(): Promise<string | null> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return null
    const body = (await response.json()) as { commitSha?: string }
    return body.commitSha ?? null
  } catch {
    return null
  }
}

/**
 * Open PRs, each with its checks, as the decision functions want them.
 *
 * Checks are fetched only for the PRs that could possibly be landed — one `gh
 * pr checks` call per PR, and this repo routinely has twenty open. The rest are
 * returned as listed; `landablePullRequests` rejects them on the branch name or
 * the missing runner marker, before any check matters.
 */
function openPullRequests(): PullRequestSummary[] {
  const listed = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '60',
      '--json',
      'number,headRefName,title,body,isDraft,mergeable,mergeStateStatus',
    ]),
  ) as PullRequestSummary[]

  const isCandidate = (pr: PullRequestSummary) =>
    carriesTaskId(pr.headRefName) &&
    (options.includeHandOpened || (pr.body ?? '').includes(RUNNER_PR_MARKER))

  return listed.map(pr => {
    if (!isCandidate(pr)) return pr

    // A fresh `UNKNOWN` resolves once GitHub computes mergeability, and asking
    // for the single PR is what triggers that. One retry, then leave it for the
    // next tick rather than treating "not computed" as "not mergeable".
    let resolved = pr
    if (pr.mergeable === 'UNKNOWN') {
      try {
        const again = JSON.parse(
          run('gh', ['pr', 'view', String(pr.number), '--json', 'mergeable,mergeStateStatus']),
        ) as { mergeable?: string; mergeStateStatus?: string }
        resolved = { ...pr, ...again }
      } catch {
        // Leave it as UNKNOWN; the decision function treats that as a wait.
      }
    }

    // `gh pr checks` exits non-zero when any check is failing, which is a
    // verdict and not an error — so its output is read either way.
    let raw = '[]'
    try {
      raw = run('gh', ['pr', 'checks', String(pr.number), '--json', 'name,bucket'])
    } catch (error) {
      const stdout = (error as { stdout?: Buffer | string }).stdout
      if (stdout) raw = stdout.toString()
    }
    let checks: Array<{ name: string; bucket: string }> = []
    try {
      checks = JSON.parse(raw)
    } catch {
      checks = []
    }
    return { ...resolved, checks }
  })
}

async function main() {
  run('git', ['fetch', 'origin', '--quiet'])

  const { land, skipped } = landablePullRequests(openPullRequests(), {
    requireRunnerMarker: !options.includeHandOpened,
  })
  for (const skip of skipped) log(`  #${skip.number} held back — ${skip.why}`)

  const take = land.slice(0, Math.max(0, options.maxLand))
  const deferred = land.slice(take.length).map(pr => pr.number)
  if (deferred.length) {
    log(`  ${deferred.length} more green PR(s) left for the next tick: ${deferred.map(n => `#${n}`).join(', ')}`)
  }

  const landed: number[] = []
  for (const pr of take) {
    if (options.dryRun) {
      log(`  would land #${pr.number} (${pr.headRefName})`)
      landed.push(pr.number)
      continue
    }
    try {
      // No `--delete-branch`: it merges server-side and then does LOCAL git
      // work, which fails on a dirty tree and makes a successful merge look
      // like a failure (see landedDespiteError). The remote branch is tidied
      // separately, where failing costs nothing.
      run('gh', ['pr', 'merge', String(pr.number), '--merge'])
      log(`  landed #${pr.number} (${pr.headRefName})`)
      landed.push(pr.number)
      deleteRemoteBranch(pr.headRefName)
    } catch (error) {
      // The exit code is not the answer; GitHub is.
      let state: string | undefined
      try {
        state = (
          JSON.parse(run('gh', ['pr', 'view', String(pr.number), '--json', 'state'])) as {
            state?: string
          }
        ).state
      } catch {
        state = undefined
      }
      if (landedDespiteError(state)) {
        log(`  landed #${pr.number} (${pr.headRefName}) — gh reported an error after merging`)
        landed.push(pr.number)
        deleteRemoteBranch(pr.headRefName)
      } else {
        log(`  ⚠️  could not land #${pr.number}: ${(error as Error).message.split('\n')[0]}`)
      }
    }
  }

  run('git', ['fetch', 'origin', '--quiet'])

  // What a deploy would ship, as a git question. Only a successful deploy moves
  // `origin/prod` (scripts/advance-prod-branch.sh), so this is the delta.
  const unshipped = run('git', ['rev-list', '--count', 'origin/prod..origin/main']).trim()
  const sha = run('git', ['rev-parse', 'origin/main']).trim()
  const hasSomethingToShip = Number(unshipped) > 0
  log(`  ${unshipped} commit(s) on main that production is not serving`)

  const pending = pendingMigrations(
    run('git', ['diff', '--name-only', 'origin/prod', 'origin/main', '--', 'prisma/migrations/']),
  )
  if (pending.length) log(`  pending migration(s): ${pending.join(', ')}`)

  // WHICH GATE LICENSES THIS DEPLOY, and why it is not a local predeploy by
  // default. `deploy-production` is `needs: [quality-gates, database-migration]`
  // and runs only when `quality-gates.outputs.quality-passed == 'true'` (with
  // `skip_tests=false`, which this script always sends). So the workflow gates
  // the exact ref it is about to ship, in a clean checkout, and refuses to
  // deploy a red one — nothing reaches production on a red gate whether or not
  // this script checked first.
  //
  // Running predeploy here as well would cost ~4 minutes a tick to re-answer
  // that, and it would answer it WORSE: predeploy's TypeScript gate reads
  // `.next/types`, which a previous branch's build leaves stale, so it goes red
  // on a tree that is fine (AWTD-1245). Unattended, that false red would block
  // deploys and post a failure nobody is watching for. CI builds from scratch
  // and cannot have it.
  //
  // `--gate` runs it anyway, for an interactive run that wants the answer
  // before spending ten minutes on a pipeline.
  const needsGate = hasSomethingToShip && !pending.length
  let predeployGreen = true
  if (needsGate && options.gate && !options.dryRun) {
    log('  running predeploy on the merged main…')
    predeployGreen = succeeds('npm', ['run', 'predeploy'], 1_800_000)
    log(`  predeploy ${predeployGreen ? 'green' : 'RED'}`)
  } else if (needsGate) {
    log("  gate: the workflow's own quality-gates job (skip_tests=false)")
  }

  const verdict = deployVerdict({
    landedOrAlreadyOnMain: hasSomethingToShip,
    pending,
    predeployGreen,
  })

  let verified = false
  let runUrl: string | undefined
  let runFailed: string[] = []

  if (verdict.deploy && !options.dryRun) {
    run('gh', [
      'workflow',
      'run',
      WORKFLOW,
      '--ref',
      'main',
      '-f',
      'skip_tests=false',
      '-f',
      'allow_destructive_migrations=false',
    ])
    // The dispatch returns no id, so the run is looked up after it registers.
    await new Promise(resolve => setTimeout(resolve, 12_000))
    const runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        `--workflow=${WORKFLOW}`,
        '--limit',
        '1',
        '--json',
        'databaseId,url,headSha',
      ]),
    ) as Array<{ databaseId: number; url: string; headSha: string }>
    const dispatched = runs[0]
    runUrl = dispatched?.url
    log(`  deploying: ${runUrl ?? '(run id not found)'}`)

    if (dispatched) {
      // Watch to completion. A green early step is not a green pipeline — this
      // rule was once rewritten from a check made 2m40s into ~10 minutes.
      succeeds('gh', ['run', 'watch', String(dispatched.databaseId), '--exit-status'], 2_400_000)

      // Which jobs failed, if any. "Deployed but unverified" and "the gate went
      // red so nothing deployed" are different events and must not share a
      // sentence — production is unchanged in the second.
      try {
        const view = JSON.parse(
          run('gh', ['run', 'view', String(dispatched.databaseId), '--json', 'conclusion,jobs']),
        ) as { conclusion: string; jobs: Array<{ name: string; conclusion: string }> }
        if (view.conclusion !== 'success') {
          runFailed = view.jobs
            .filter(job => job.conclusion && !['success', 'skipped'].includes(job.conclusion))
            .map(job => job.name)
          if (!runFailed.length) runFailed = [`run ${view.conclusion}`]
        }
      } catch {
        // Fall through to the health check, which is the stronger signal.
      }
    }

    // Then ask production, which is the only answer that counts (AWTD-959).
    const serving = await servingSha()
    const check = deployLanded({ expectedSha: sha, servingSha: serving })
    verified = check.ok
    log(verified ? `  production is serving ${sha.slice(0, 8)}` : `  ⚠️  ${check.reason}`)
    if (runFailed.length) log(`  deploy run failed: ${runFailed.join(', ')}`)
  } else if (verdict.deploy) {
    log(`  would deploy ${sha.slice(0, 8)}`)
    verified = true
  } else {
    log(`  not deploying — ${verdict.reason}`)
  }

  const news = summary({
    landed,
    skipped,
    verdict,
    sha,
    runUrl,
    verified,
    dryRun: options.dryRun,
    deferred,
    runFailed,
  })
  log('')
  log(news)

  if (options.listId && !options.dryRun) {
    const worthPosting = verdict.deploy || verdict.code !== 0
    if (worthPosting) {
      try {
        execFileSync('npx', ['tsx', 'scripts/post-list-message.ts', options.listId, news], {
          cwd: options.repo,
          encoding: 'utf8',
          timeout: 60_000,
        })
      } catch (error) {
        log(`  ⚠️  could not post to list chat: ${(error as Error).message.split('\n')[0]}`)
      }
    }
  }

  if (verdict.deploy) process.exit(verified ? 0 : 5)
  process.exit(verdict.code)
}

main().catch(error => {
  console.error(`land-and-deploy failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
