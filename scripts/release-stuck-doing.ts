#!/usr/bin/env tsx
/**
 * Move this agent's abandoned Doing claims back out of Doing.
 *
 * The rules and why they exist: scripts/lib/doing-release.ts. This is the I/O.
 *
 * Usage (both scheduled loops call it; astrid-ios runs it from ../astrid-web):
 *   # After a run: release exactly what that run claimed and left in Doing.
 *   npx tsx scripts/release-stuck-doing.ts --agent claude --claims-file <file> [--repo <path>]
 *   # Tick start: release claims idle for N minutes that no runner holds.
 *   npx tsx scripts/release-stuck-doing.ts --agent claude --list <listId> --stale-minutes 180 [--repo <path>]
 *   # Either, printing what would move and writing nothing:
 *   ... --dry-run
 *
 * `--repo` is where the task branches live (git ls-remote origin), so a release
 * can name the branch that carries the work. Defaults to the current directory.
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
import {
  DEFAULT_STALE_DOING_MINUTES,
  isAbandonedClaim,
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

async function main() {
  const mailbox = arg('--agent')
  const claimsFile = arg('--claims-file')
  const listId = arg('--list')
  const staleMinutes = Number(arg('--stale-minutes') ?? DEFAULT_STALE_DOING_MINUTES)
  const repo = arg('--repo') ?? process.cwd()
  const dryRun = process.argv.includes('--dry-run')

  if (!mailbox || !FIXALL_CLAIM_MAILBOXES.includes(mailbox) || (!claimsFile && !listId)) {
    console.error(
      'Usage: release-stuck-doing.ts --agent <mailbox> (--claims-file <file> | --list <listId> [--stale-minutes N]) [--repo <path>] [--dry-run]',
    )
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
  if (claimsFile && !listId && claimed.length === 0) return

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

  // Candidates: what this run claimed, plus (tick start) everything in Doing on the board.
  const candidates: Array<{ id: string; mode: 'claims' | 'stale' }> = claimed.map(id => ({ id, mode: 'claims' }))
  if (listId) {
    const response = await fetch(
      `${API}/api/v1/tasks?listId=${encodeURIComponent(listId)}&completed=false&leanListMembers=1&limit=500`,
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
    if (!task || !isReleasableClaim(task, email)) continue
    const comments = await sweep.comments(task)
    if (mode === 'stale' && !isAbandonedClaim({ updatedAt: task.updatedAt, comments, now, staleMinutes })) continue

    const why = mode === 'claims'
      ? 'The scheduled run that claimed it ended before finishing it.'
      : `It sat in Doing with no activity for over ${Math.round(staleMinutes / 60 * 10) / 10}h, so the session that claimed it is gone.`
    const outcome = await releaseDoingClaim({ task, comments, branches: branchesOnce(), why, api })
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
