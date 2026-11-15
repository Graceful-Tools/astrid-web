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
 * With `--core-repo <owner/name>` and `--list-id` it also lands astrid-core PRs that
 * cloud runs handed off with `AWAITING-MERGE: <repo>#<n> <sha>` (AWTD-1682): at most
 * `--max-land` a tick, under the same proof as a web cloud PR, merged with a merge commit
 * pinned to the inspected head. Core has no deploy, so each task whose PR is merged at
 * its recorded head is then completed, whoever merged it. Writes to that repo use
 * `ASTRID_CORE_GH_TOKEN`; without it the merge is skipped and the completions still run.
 *
 * Usage:
 *   npx tsx scripts/land-and-deploy.ts [--repo <path>] [--list-id <id>]
 *                                      [--dry-run] [--gate] [--max-land <n>]
 *                                      [--include-hand-opened] [--pr <n>]
 *                                      [--core-repo <owner/name>]
 *
 * Exit codes — chosen so the caller can tell "did not" from "could not":
 *   0  deployed and verified, or nothing to do
 *   2  refused: allow_destructive_migrations (never set by the loop)
 *   3  did not deploy: a destructive (or unreadable) pending migration needs a human
 *   4  did not deploy: the gate is red on the merged main
 *   5  deployed and could NOT verify production is serving it
 *   1  something broke (git, gh, network)
 *
 * The decisions live in scripts/lib/land-and-deploy.ts and are unit-tested in
 * tests/scripts/land-and-deploy.test.ts. This file is the shell: it gathers
 * facts, applies them, and reports.
 */

import { execFileSync } from 'child_process'
import { isAwaitingDeployLane, parseBlockedConditions } from '@/lib/ready-queue-scope'
import { resolveAgentAuthorId } from './lib/agent-author'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { AGENT_BRANCH, cloudHandoffEligible } from './lib/cloud-handoff'
import {
  coreHandoffEligible,
  coreTasksMerged,
  landableCorePullRequests,
  latestHandoff,
  mergedCompletionComment,
  type AwaitingMergeTask,
  type CorePullRequest,
  type CorePullRequestState,
} from './lib/core-handoff'
import { isAwaitingDeploy, isAwaitingMerge } from './lib/doing-release'
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
  migrationHold,
  migrationSqlPath,
  pendingMigrations,
  summary,
  tasksProductionServes,
  taskIdsInBranch,
  automaticDeployHold,
  type AwaitingDeployTask,
  type PendingMigration,
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
  coreRepo: string | null
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
    coreRepo: value('--core-repo'),
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
 * Done means deployed, so a run leaves finished work incomplete in Doing (or a
 * board's optional Testing column) with `AWAITING-DEPLOY: <sha>` (R6). This runs every tick, not only after a
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
  const finished = (listed as Array<{ id: string; identifier?: string | null; statusRole?: string | null; completed?: boolean;
    assignee?: { email?: string | null } | null }>)
    .filter(isAwaitingDeployLane)

  const awaiting: AwaitingDeployTask[] = []
  for (const task of finished) {
    const comments = await api.comments(task)
    // Only a CURRENT handoff: a task reopened after completion, released, or claimed
    // again for a redo still carries its old marker, and production already serves it.
    if (!isAwaitingDeploy(comments)) continue
    const sha = parseBlockedConditions(comments).awaitingDeploy
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
    const original = finished.find(row => row.id === task.id)
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

    return { ...resolved, checks: prChecks(args => run('gh', args), [String(pr.number)]) }
  })
}

/**
 * `gh pr checks --json name,bucket` for one PR. It exits non-zero when any check is
 * failing, which is a verdict and not an error, so its output is read either way.
 */
function prChecks(gh: (args: string[]) => string, args: string[]): Array<{ name: string; bucket: string }> {
  let raw = '[]'
  try {
    raw = gh(['pr', 'checks', ...args, '--json', 'name,bucket'])
  } catch (error) {
    const stdout = (error as { stdout?: Buffer | string }).stdout
    if (stdout) raw = stdout.toString()
  }
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/** `gh` against the core repo, with its own token when the ship job holds one (AWTD-1682). */
function ghCore(args: string[]): string {
  const token = process.env.ASTRID_CORE_GH_TOKEN
  return execFileSync('gh', args, {
    cwd: options.repo,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(token ? { GH_TOKEN: token } : {}) },
  }).toString()
}

async function astridAuth(): Promise<{ token: string; auth: Record<string, string> }> {
  const response = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID, client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET }),
  })
  if (!response.ok) throw new Error(`Astrid authentication failed: HTTP ${response.status}`)
  const token = ((await response.json()) as { access_token: string }).access_token
  return { token, auth: { 'X-OAuth-Token': token } }
}

interface CoreTick {
  landed: string[]
  skipped: Array<{ ref: string; why: string }>
  completed: string[]
}

/**
 * Land the eligible astrid-core handoffs, then complete every core task whose PR merged
 * (AWTD-1682). Same one-at-a-time cap as web: core merges deploy nothing, but one a tick
 * keeps each one reviewable.
 */
async function landAndCompleteCore(repo: string, listId: string): Promise<CoreTick> {
  const ref = (n: number) => `${repo}#${n}`
  const result: CoreTick = { landed: [], skipped: [], completed: [] }
  const { token, auth } = await astridAuth()

  const listed = JSON.parse(ghCore(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '60', '--json',
    'number,headRefName,headRefOid,baseRefName,title,isDraft,mergeable,mergeStateStatus'])) as CorePullRequest[]
  const prs: CorePullRequest[] = []
  for (const pr of listed) {
    const identifier = AGENT_BRANCH.exec(pr.headRefName)?.[2]
    if (!identifier || pr.baseRefName !== 'main') { prs.push(pr); continue }
    const taskResponse = await fetch(`${API}/api/v1/tasks/${encodeURIComponent(identifier)}`, { headers: auth })
    if (!taskResponse.ok) {
      result.skipped.push({ ref: ref(pr.number), why: `task ${identifier} could not be read (HTTP ${taskResponse.status})` })
      continue
    }
    const body = await taskResponse.json()
    const task = body.task ?? body
    const commentsResponse = await fetch(`${API}/api/v1/tasks/${task.id}/comments`, { headers: auth })
    if (!commentsResponse.ok) throw new Error(`Core handoff comments failed: HTTP ${commentsResponse.status}`)
    const comments = (await commentsResponse.json()).comments ?? []
    const valid = coreHandoffEligible({ repo, pr, listId, task, comments })
    let resolved: CorePullRequest = { ...pr, cloudHandoffValid: valid }
    if (valid) {
      if (pr.mergeable === 'UNKNOWN') {
        try {
          resolved = { ...resolved, ...JSON.parse(ghCore(['pr', 'view', String(pr.number), '--repo', repo,
            '--json', 'mergeable,mergeStateStatus'])) }
        } catch {
          // Still UNKNOWN: the decision treats that as a wait.
        }
      }
      resolved.checks = prChecks(ghCore, [String(pr.number), '--repo', repo])
    }
    prs.push(resolved)
  }

  const { land, skipped } = landableCorePullRequests(prs)
  for (const skip of skipped) {
    log(`  ${ref(skip.number)} held back — ${skip.why}`)
    result.skipped.push({ ref: ref(skip.number), why: skip.why })
  }
  const take = land.slice(0, Math.max(0, options.maxLand))
  for (const pr of land.slice(take.length)) log(`  ${ref(pr.number)} is green too — left for the next tick`)
  for (const pr of take) {
    if (options.dryRun) {
      log(`  would land ${ref(pr.number)} (${pr.headRefName})`)
      result.landed.push(ref(pr.number))
      continue
    }
    if (!process.env.ASTRID_CORE_GH_TOKEN) {
      const why = `eligible, but this job holds no token that can merge on ${repo} (ASTRID_CORE_GH_TOKEN)`
      log(`  ⚠️  ${ref(pr.number)} — ${why}`)
      result.skipped.push({ ref: ref(pr.number), why })
      continue
    }
    try {
      if (!pr.headRefOid) throw new Error('PR head SHA was not captured with its checks')
      ghCore(['pr', 'merge', String(pr.number), '--repo', repo, '--merge', '--match-head-commit', pr.headRefOid])
      log(`  landed ${ref(pr.number)} (${pr.headRefName})`)
      result.landed.push(ref(pr.number))
    } catch (error) {
      let state: string | undefined
      try {
        state = (JSON.parse(ghCore(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'state'])) as { state?: string }).state
      } catch {
        state = undefined
      }
      if (landedDespiteError(state)) {
        log(`  landed ${ref(pr.number)} (${pr.headRefName}) — gh reported an error after merging`)
        result.landed.push(ref(pr.number))
      } else {
        const why = `could not land: ${(error as Error).message.split('\n')[0]}`
        log(`  ⚠️  ${ref(pr.number)} ${why}`)
        result.skipped.push({ ref: ref(pr.number), why })
      }
    }
  }

  // Completion: every core handoff on the board whose PR has merged, this tick or by hand.
  const boardResponse = await fetch(boardTasksUrl({ boardId: listId, limit: 500 }), { headers: auth })
  if (!boardResponse.ok) {
    log(`  ⚠️  awaiting-merge check skipped: board read failed with HTTP ${boardResponse.status}`)
    return result
  }
  const boardBody = (await boardResponse.json()) as { tasks?: unknown } | unknown[]
  const listedTasks = ((Array.isArray(boardBody) ? boardBody : (boardBody as { tasks?: unknown }).tasks) ?? []) as Array<{
    id: string; identifier?: string | null; statusRole?: string | null; completed?: boolean
    assignee?: { email?: string | null } | null }>
  const lane = listedTasks.filter(isAwaitingDeployLane)
  const api = new SweepApi(auth, options.dryRun, (...args) => log(args.join(' ')))
  const awaiting: AwaitingMergeTask[] = []
  for (const task of lane) {
    const comments = await api.comments(task)
    if (!isAwaitingMerge(comments)) continue
    const handoff = latestHandoff(comments)
    if (handoff?.kind === 'merge' && handoff.repo.toLowerCase() === repo.toLowerCase()) {
      awaiting.push({ id: task.id, identifier: task.identifier, repo: handoff.repo, number: handoff.number, sha: handoff.sha })
    }
  }
  if (!awaiting.length) return result

  const { done, waiting } = coreTasksMerged({
    awaiting,
    pullRequest: (prRepo, number): CorePullRequestState | null => {
      try {
        return JSON.parse(ghCore(['pr', 'view', String(number), '--repo', prRepo, '--json', 'state,headRefOid,mergeCommit']))
      } catch {
        return null
      }
    },
  })
  for (const { task, why } of waiting) log(`  ${task.identifier ?? task.id} awaits ${ref(task.number)}: ${why}`)
  for (const task of done) {
    const name = task.identifier ?? task.id
    if (options.dryRun) {
      log(`  would mark ${name} complete — ${ref(task.number)} merged as ${task.mergeSha.slice(0, 8)}`)
      result.completed.push(name)
      continue
    }
    const mailbox = agentMailboxFromEmail(lane.find(row => row.id === task.id)?.assignee?.email ?? '')
    if (!mailbox) {
      log(`  ⚠️  ${name} has no agent assignee; refusing to complete it under the wrong name`)
      continue
    }
    const authorId = await resolveAgentAuthorId({ mailbox, accessToken: token, warn: log })
    const attributed = new SweepApi(auth, options.dryRun, (...args) => log(args.join(' ')), authorId)
    // Comment first: a completed task with no word on why is the worse failure.
    await attributed.comment(task, mergedCompletionComment(task))
    if (await attributed.complete(task)) {
      log(`  marked ${name} complete — ${ref(task.number)} merged as ${task.mergeSha.slice(0, 8)}`)
      result.completed.push(name)
    }
  }
  return result
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

  const pendingNames = pendingMigrations(
    run('git', ['diff', '--name-only', 'origin/prod', 'origin/main', '--', 'prisma/migrations/']),
  )
  if (pendingNames.length) log(`  pending migration(s): ${pendingNames.join(', ')}`)

  // AWTD-1680: the SQL is read from the merged main itself, not the working
  // tree, which may be any branch. Unreadable stays null and holds the deploy.
  const pending: PendingMigration[] = pendingNames.map(name => {
    try {
      return { name, sql: run('git', ['show', `origin/main:${migrationSqlPath(name)}`]) }
    } catch {
      return { name, sql: null }
    }
  })
  const heldByMigration = migrationHold(pending)
  if (pending.length && !heldByMigration) log('  all pending migrations are additive — they ship with this deploy')

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
  const needsGate = hasSomethingToShip && !heldByMigration
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

  let core: CoreTick = { landed: [], skipped: [], completed: [] }
  if (options.coreRepo && options.listId) {
    try {
      core = await landAndCompleteCore(options.coreRepo, options.listId)
    } catch (error) {
      log(`  ⚠️  astrid-core landing failed: ${(error as Error).message.split('\n')[0]}`)
    }
  } else if (options.coreRepo) {
    log('  --core-repo needs --list-id: core handoffs are checked against the board')
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
    coreLanded: core.landed,
    coreCompleted: core.completed,
    coreSkipped: core.skipped,
  })
  log('')
  log(news)

  if (options.listId && !options.dryRun) {
    const worthPosting = verdict.deploy || verdict.code !== 0 || completedTasks.length > 0 ||
      core.landed.length > 0 || core.completed.length > 0
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
