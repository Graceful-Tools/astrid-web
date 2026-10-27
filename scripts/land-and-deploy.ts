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
 * With `--list-id` it also finishes the board's `AWAITING-DEPLOY:` tasks once
 * production serves their commit (AWTD-1278) — done means deployed, so that is
 * when they complete.
 *
 * Usage:
 *   npx tsx scripts/land-and-deploy.ts [--repo <path>] [--list-id <id>]
 *                                      [--dry-run] [--gate] [--max-land <n>]
 *                                      [--include-hand-opened] [--pr <n>]
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
import { parseBlockedConditions } from '@/lib/ready-queue-scope'
import { WAITING_STATUS_ROLE } from '@/lib/task-status'
import { resolveAgentAuthorId } from './lib/agent-author'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { cloudHandoffEligible } from './lib/cloud-handoff'
import { boardTasksUrl } from './lib/board-read-url'
import { loadScriptEnv } from './lib/load-env'
import { SweepApi } from './lib/sweep-api'
import {
  RUNNER_PR_MARKER,
  carriesTaskId,
  deployedCompletionComment,
  deployLanded,
  landedDespiteError,
  deployVerdict,
  landablePullRequests,
  pendingMigrations,
  summary,
  tasksProductionServes,
  taskIdsInBranch,
  automaticDeployHold,
  type AwaitingDeployTask,
  type PullRequestSummary,
} from './lib/land-and-deploy'

loadScriptEnv()

const WORKFLOW = 'production-deployment.yml'
const API = 'https://astrid.cc'
const HEALTH_URL = `${API}/api/health`

interface Options {
  repo: string
  listId: string | null
  dryRun: boolean
  gate: boolean
  maxLand: number
  includeHandOpened: boolean
  only: number[]
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
    // `--pr 420 --pr 421` lands exactly those. Without it, every landable PR
    // up to --max-land goes, which is what an unattended tick wants.
    only: argv.flatMap((arg, i) => (arg === '--pr' ? [Number(argv[i + 1])] : [])).filter(Boolean),
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
 * Complete the board's tasks whose deploy production now serves (AWTD-1278).
 *
 * Done means deployed, so a scheduled run leaves finished work incomplete in
 * Waiting with `AWAITING-DEPLOY: <sha>`. This runs every tick, not only after a
 * deploy this tick made: a deploy dispatched by hand finishes them too, and one
 * that failed finishes nothing, because the question is put to production.
 * Best effort — a failure here leaves the task waiting for the next tick.
 */
async function completeDeployedTasks(listId: string): Promise<string[]> {
  const tokenResponse = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
    }),
  })
  if (!tokenResponse.ok) {
    log(`  ⚠️  awaiting-deploy check skipped: OAuth token request failed with HTTP ${tokenResponse.status}`)
    return []
  }
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string }
  const auth = { 'X-OAuth-Token': token }
  const api = new SweepApi(auth, options.dryRun, (...args) => log(args.join(' ')))

  const boardResponse = await fetch(boardTasksUrl({ boardId: listId, limit: 500 }), { headers: auth })
  if (!boardResponse.ok) {
    log(`  ⚠️  awaiting-deploy check skipped: board read failed with HTTP ${boardResponse.status}`)
    return []
  }
  const boardBody = (await boardResponse.json()) as { tasks?: unknown } | unknown[]
  const listed = (Array.isArray(boardBody) ? boardBody : (boardBody as { tasks?: unknown }).tasks) ?? []
  const waiting = (listed as Array<{ id: string; identifier?: string | null; statusRole?: string | null; completed?: boolean;
    assignee?: { email?: string | null } | null }>)
    .filter(task => !task.completed && (task.statusRole ?? '').trim().toLowerCase() === WAITING_STATUS_ROLE)

  const awaiting: AwaitingDeployTask[] = []
  for (const task of waiting) {
    const sha = parseBlockedConditions(await api.comments(task)).awaitingDeploy
    if (sha) awaiting.push({ id: task.id, identifier: task.identifier, sha })
  }
  if (!awaiting.length) return []

  const serving = await servingSha()
  const done = tasksProductionServes({
    servingSha: serving,
    awaiting,
    // An unknown commit (not fetched, squash-merged away) is "not yet", never "yes".
    contains: (commit, tip) => succeeds('git', ['merge-base', '--is-ancestor', commit, tip], 30_000),
  })
  for (const task of awaiting.filter(t => !done.includes(t))) {
    log(`  ${task.identifier ?? task.id} awaits its deploy: production does not serve ${task.sha.slice(0, 8)} yet`)
  }

  const completed: string[] = []
  for (const task of done) {
    const name = task.identifier ?? task.id
    if (options.dryRun) {
      log(`  would mark ${name} complete — production serves ${task.sha.slice(0, 8)}`)
      completed.push(name)
      continue
    }
    // Comment first: a completed task with no word on why is the worse failure.
    const original = waiting.find(row => row.id === task.id)
    const mailbox = agentMailboxFromEmail(original?.assignee?.email ?? '')
    if (!mailbox) throw new Error(`Awaiting-deploy task ${name} has no agent assignee; refusing incorrect attribution`)
    const authorId = await resolveAgentAuthorId({ mailbox, accessToken: token, warn: log })
    const attributed = new SweepApi(auth, options.dryRun, (...args) => log(args.join(' ')), authorId)
    await attributed.comment(task, deployedCompletionComment({ sha: task.sha, servingSha: serving ?? '' }))
    if (await attributed.complete(task)) {
      log(`  marked ${name} complete — production serves ${task.sha.slice(0, 8)}`)
      completed.push(name)
    }
  }
  return completed
}

/**
 * Open PRs, each with its checks, as the decision functions want them.
 *
 * Checks are fetched only for the PRs that could possibly be landed — one `gh
 * pr checks` call per PR, and this repo routinely has twenty open. The rest are
 * returned as listed; `landablePullRequests` rejects them on the branch name or
 * the missing runner marker, before any check matters.
 */
async function openPullRequests(): Promise<PullRequestSummary[]> {
  const listed = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '60',
      '--json',
      'number,headRefName,headRefOid,title,body,isDraft,mergeable,mergeStateStatus',
    ]),
  ) as PullRequestSummary[]

  const isCandidate = (pr: PullRequestSummary) =>
    carriesTaskId(pr.headRefName) &&
    (options.includeHandOpened || (pr.body ?? '').includes(RUNNER_PR_MARKER))

  let token: string | undefined
  for (const pr of listed.filter(pr => isCandidate(pr) && pr.headRefName.startsWith('agent/'))) {
    if (!options.listId || !pr.headRefOid) continue
    if (!token) {
      const response = await fetch(`${API}/api/v1/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials',
          client_id: process.env.ASTRID_OAUTH_CLIENT_ID, client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET }),
      })
      if (!response.ok) throw new Error(`Cloud handoff authentication failed: HTTP ${response.status}`)
      token = ((await response.json()) as { access_token: string }).access_token
    }
    const identifier = taskIdsInBranch(pr.headRefName)[0]
    if (!identifier) continue
    const auth = { 'X-OAuth-Token': token }
    const response = await fetch(`${API}/api/v1/tasks/${encodeURIComponent(identifier)}`, { headers: auth })
    if (!response.ok) throw new Error(`Cloud handoff task read failed: HTTP ${response.status}`)
    const body = await response.json()
    const task = body.task ?? body
    const commentsResponse = await fetch(`${API}/api/v1/tasks/${task.id}/comments`, { headers: auth })
    if (!commentsResponse.ok) throw new Error(`Cloud handoff comments failed: HTTP ${commentsResponse.status}`)
    const commentsBody = await commentsResponse.json()
    pr.cloudHandoffValid = cloudHandoffEligible({
      branch: pr.headRefName, headSha: pr.headRefOid, task,
      listId: options.listId, comments: commentsBody.comments ?? [],
    })
  }

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

  const { land, skipped } = landablePullRequests(await openPullRequests(), {
    requireRunnerMarker: !options.includeHandOpened,
    only: options.only,
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
      if (!pr.headRefOid) throw new Error('PR head SHA was not captured with its checks')
      run('gh', ['pr', 'merge', String(pr.number), '--merge', '--match-head-commit', pr.headRefOid])
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

  let verdict = deployVerdict({
    landedOrAlreadyOnMain: hasSomethingToShip,
    pending,
    predeployGreen,
  })

  let verified = false
  let runUrl: string | undefined
  let runFailed: string[] = []

  if (verdict.deploy && !options.dryRun) {
    const previous = JSON.parse(run('gh', ['run', 'list', `--workflow=${WORKFLOW}`, '--commit', sha,
      '--limit', '20', '--json', 'status,conclusion'])) as Array<{ status: string; conclusion: string | null }>
    const hold = automaticDeployHold(previous)
    if (hold) verdict = { deploy: false, code: 4, reason: hold }
  }

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
      '-f',
      `expected_sha=${sha}`,
    ])
    // The dispatch returns no id, so the run is looked up after it registers.
    await new Promise(resolve => setTimeout(resolve, 12_000))
    const runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        `--workflow=${WORKFLOW}`,
        '--commit',
        sha,
        '--limit',
        '5',
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

  let completedTasks: string[] = []
  if (options.listId) {
    try {
      completedTasks = await completeDeployedTasks(options.listId)
    } catch (error) {
      log(`  ⚠️  awaiting-deploy check failed: ${(error as Error).message.split('\n')[0]}`)
    }
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
    completedTasks,
  })
  log('')
  log(news)

  if (options.listId && !options.dryRun) {
    const worthPosting = verdict.deploy || verdict.code !== 0 || completedTasks.length > 0
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
