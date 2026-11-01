#!/usr/bin/env tsx
/**
 * Move this agent's abandoned Doing claims back out of Doing.
 *
 * The rules and why they exist: scripts/lib/doing-release.ts. This is the I/O.
 *
 * Usage (both scheduled loops call it; astrid-ios runs it from ../astrid-web):
 *   # After a run: release exactly what that run claimed and left in Doing.
 *   npx tsx scripts/release-stuck-doing.ts --agent claude --claims-file <file> [--saved-branch <name>] [--repo <path>]
 *   # Tick start: release claims idle for N minutes that no runner holds.
 *   npx tsx scripts/release-stuck-doing.ts --agent claude --list <listId> --stale-minutes 180 [--repo <path>]
 *   # ...or name the board instead of carrying its id (AWTD-1267; astrid-windows keeps no ids):
 *   npx tsx scripts/release-stuck-doing.ts --agent claude --board windows --stale-minutes 180 [--repo <path>]
 *   # Either, printing what would move and writing nothing:
 *   ... --dry-run
 *
 * `--repo` is where the task branches live (git ls-remote origin), so a release
 * can name the branch that carries the work. Defaults to the current directory.
 * Branches already merged into origin/main there are never named (AWTD-1471).
 * `--saved-branch` names the branch the loop saved the run's unfinished work on
 * (a `wip/…` snapshot carries no task id); it is named first, for the run's claims.
 *
 * Exit 0 on success, including "nothing to release"; 1 on a usage or auth error.
 * Never fatal to the loop that calls it — a release that fails leaves a task in
 * Doing, which is the state it was already in.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { loadScriptEnv } from './lib/load-env'
import { resolveAgentAuthorId } from './lib/agent-author'
import { SweepApi } from './lib/sweep-api'
import { boardTasksUrl } from './lib/board-read-url'
import { parseBoardTarget, resolveBoardListId, type BoardTarget } from './lib/board-by-name'
import {
  DEFAULT_STALE_DOING_MINUTES,
  isAbandonedClaim,
  isAwaitingBuild,
  isOrphanedDoing,
  isReleasableClaim,
  releaseDoingClaim,
  type DoingTask,
} from './lib/doing-release'
import { agentEmail } from '@/lib/brand/agent-emails'
import { FIXALL_CLAIM_MAILBOXES } from '@/lib/fixall-claim'
import { DOING_STATUS_ROLE } from '@/lib/task-status'

loadScriptEnv()

const API = 'https://astrid.cc'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

function remoteBranches(repo: string): string[] {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-remote', '--heads', 'origin'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 30_000,
    })
      .split('\n')
      .map(line => line.split('refs/heads/')[1]?.trim())
      .filter((name): name is string => Boolean(name))
  } catch {
    return []
  }
}

/**
 * Remote branches already merged into origin/main, as `ls-remote` names them
 * (`fix/x`, not `origin/fix/x`). Read from --repo's remote-tracking refs, so a
 * branch it has never fetched is simply not excluded. Empty on any git error.
 */
function mergedRemoteBranches(repo: string): string[] {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', 'branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 30_000,
    })
      .split('\n')
      .map(line => line.trim())
      .filter(name => name.startsWith('origin/') && name !== 'origin/main' && name !== 'origin/HEAD')
      .map(name => name.slice('origin/'.length))
  } catch {
    return []
  }
}

async function main() {
  const mailbox = arg('--agent')
  const claimsFile = arg('--claims-file')
  const staleMinutes = Number(arg('--stale-minutes') ?? DEFAULT_STALE_DOING_MINUTES)
  const repo = arg('--repo') ?? process.cwd()
  const dryRun = process.argv.includes('--dry-run')
  // Where the loop saved this run's unfinished work (AWTD-1471). Only the run's own
  // claims get it; the idle backstop has no way to know which run a branch came from.
  const savedBranch = arg('--saved-branch')

  const usage =
    'Usage: release-stuck-doing.ts --agent <mailbox> (--claims-file <file> [--saved-branch <name>] | (--list <listId> | --board <web|ios|windows|android>) [--stale-minutes N]) [--repo <path>] [--dry-run]'
  let target: BoardTarget | null
  try {
    target = parseBoardTarget({ list: arg('--list'), board: arg('--board') })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}\n${usage}`)
    process.exit(1)
  }
  if (!mailbox || !FIXALL_CLAIM_MAILBOXES.includes(mailbox) || (!claimsFile && !target)) {
    console.error(usage)
    process.exit(1)
  }
  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    console.error(`--stale-minutes must be a positive number, not "${arg('--stale-minutes')}"`)
    process.exit(1)
  }

  // A run that claimed nothing leaves an empty or absent file: nothing to do,
  // and no reason to spend a token request finding that out.
  const claimed = claimsFile && existsSync(claimsFile)
    ? Array.from(new Set(readFileSync(claimsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)))
    : []
  if (claimsFile && !target && claimed.length === 0) return

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('RELEASE: skipped — ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing')
    process.exit(1)
  }
  const tokenResponse = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!tokenResponse.ok) {
    console.error(`RELEASE: skipped — OAuth token request failed with HTTP ${tokenResponse.status}`)
    process.exit(1)
  }
  const { access_token: token } = await tokenResponse.json()
  const auth = { 'X-OAuth-Token': token }

  // A board named but not found is an error, never an empty board: an empty
  // board reads exactly like "no stuck claims", the silent failure that naming
  // the board instead of carrying its id exists to avoid.
  let listId: string | undefined
  if (target?.kind === 'list') listId = target.listId
  if (target?.kind === 'board') {
    try {
      listId = await resolveBoardListId({ board: target.board, auth, origin: API })
    } catch (error) {
      console.error(`RELEASE: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  }

  const report = (...args: unknown[]) => console.log(...args)
  const authorId = await resolveAgentAuthorId({ mailbox, accessToken: token, warn: report })
  const sweep = new SweepApi(auth, dryRun, report, authorId)
  const api = {
    setStatus: (task: { id: string }, role: string) => sweep.setStatus(task, role),
    comment: (task: { id: string }, content: string) => sweep.comment(task, content),
    assign: async (task: { id: string }, userId: string) => {
      if (dryRun) return
      const response = await fetch(`${API}/api/v1/tasks/${task.id}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: userId }),
      })
      if (!response.ok) report(`  ⚠️ could not assign ${task.id}: HTTP ${response.status}`)
    },
  }

  const getTask = async (id: string): Promise<DoingTask | null> => {
    const response = await fetch(`${API}/api/v1/tasks/${encodeURIComponent(id)}`, { headers: auth })
    if (!response.ok) return null
    const body = await response.json()
    return (body.task ?? body) as DoingTask
  }

  const email = agentEmail(mailbox)
  const now = new Date()
  let branches: string[] | null = null
  const branchesOnce = () => (branches ??= remoteBranches(repo))
  let merged: string[] | null = null
  const mergedOnce = () => (merged ??= mergedRemoteBranches(repo))

  // Candidates: what this run claimed, plus (tick start) everything in Doing on the board.
  const candidates: Array<{ id: string; mode: 'claims' | 'stale' }> = claimed.map(id => ({ id, mode: 'claims' }))
  if (listId) {
    // Without descriptions (AWTD-1237): this reads id, identifier, statusRole
    // and updatedAt to decide what is stuck, and never the text.
    const response = await fetch(
      boardTasksUrl({ boardId: listId, limit: 500, origin: API }),
      { headers: auth },
    )
    if (!response.ok) {
      console.error(`RELEASE: could not read the board — HTTP ${response.status}`)
      process.exit(1)
    }
    const body = await response.json()
    const tasks: DoingTask[] = body.tasks ?? []
    for (const task of tasks) {
      if ((task.statusRole ?? '').toLowerCase() === DOING_STATUS_ROLE) candidates.push({ id: task.id, mode: 'stale' })
    }
  }

  let released = 0
  for (const { id, mode } of candidates) {
    const task = await getTask(id)
    // An unassigned Doing task on the board is nobody's claim, so the idle backstop
    // takes it too (AWTD-1409); a run's own claims are always assigned.
    const releasable = task && (isReleasableClaim(task, email) || (mode === 'stale' && isOrphanedDoing(task)))
    if (!task || !releasable) continue
    const comments = await sweep.comments(task)
    // Done and pushed: it waits for its build in Doing, and close-built-tasks closes it.
    if (isAwaitingBuild(comments)) continue
    if (mode === 'stale' && !isAbandonedClaim({ updatedAt: task.updatedAt, comments, now, staleMinutes })) continue

    const why = mode === 'claims'
      ? 'The scheduled run that claimed it ended before finishing it.'
      : `It sat in Doing with no activity for over ${Math.round(staleMinutes / 60 * 10) / 10}h, so the session that claimed it is gone.`
    const outcome = await releaseDoingClaim({
      task,
      comments,
      branches: branchesOnce(),
      merged: mergedOnce(),
      savedBranch: mode === 'claims' ? savedBranch : null,
      why,
      api,
    })
    released += 1
    const label = task.identifier ?? task.id
    console.log(
      outcome.action === 'handback'
        ? `  RELEASE: ${label} → Waiting, handed back (second release)${dryRun ? ' [dry run]' : ''}`
        : `  RELEASE: ${label} → Ready (${mode === 'claims' ? 'its run ended mid-task' : 'abandoned claim'})${dryRun ? ' [dry run]' : ''}`,
    )
  }
  if (released === 0 && listId) console.log('  RELEASE: no stuck Doing claims')
}

main().catch(error => {
  console.error(`RELEASE: failed — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
