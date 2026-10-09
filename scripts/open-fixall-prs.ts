#!/usr/bin/env tsx
/**
 * Open a pull request for each task a scheduled /fixall run completed.
 *
 * Why the runner does this rather than the session: scripts/lib/fixall-prs.ts.
 *
 * Usage (both scheduled loops, after the run; astrid-ios runs it from ../astrid-web):
 *   npx tsx scripts/open-fixall-prs.ts --claims-file <file> --repo <path> [--dry-run]
 *
 * `--claims-file` is the run's claims (scripts/claim-fixall-task.ts records them);
 * `--repo` is the checkout whose origin holds the task branches — `gh` infers
 * the GitHub repository from it.
 *
 * Prints one `PR:` line per branch. Exit 0 when every completed task's branch has
 * a PR (opened now or already there), 3 when opening one failed — the loop posts
 * that to the board, since a finished task nobody is asked to review is the
 * failure this exists to end. 1 on a usage or auth error.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { loadScriptEnv } from './lib/load-env'
import { branchesForCompletedTask, prBody, prTitle, type CandidateBranch } from './lib/fixall-prs'

loadScriptEnv()

const API = 'https://astrid.cc'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    timeout: 60_000,
  })
}

const git = (repo: string, ...args: string[]) => run('git', ['-c', 'core.fsmonitor=false', ...args], repo)

/** Every origin branch main lacks commits from, with those commits' messages. */
function unmergedBranches(repo: string): CandidateBranch[] {
  git(repo, 'fetch', '-q', '--prune', 'origin')
  return git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin')
    .split('\n')
    .map(ref => ref.trim().replace(/^origin\//, ''))
    .filter(name => name && name !== 'HEAD' && name !== 'main' && name !== 'origin')
    .map(name => ({
      name,
      messages: git(repo, 'log', '--format=%B%x00', `origin/main..origin/${name}`)
        .split('\0')
        .map(message => message.trim())
        .filter(Boolean),
    }))
}

async function main() {
  const claimsFile = arg('--claims-file')
  const repo = arg('--repo')
  const dryRun = process.argv.includes('--dry-run')
  if (!claimsFile || !repo) {
    console.error('Usage: open-fixall-prs.ts --claims-file <file> --repo <path> [--dry-run]')
    process.exit(1)
  }

  const claimed = existsSync(claimsFile)
    ? Array.from(new Set(readFileSync(claimsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)))
    : []
  if (claimed.length === 0) return

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
    console.error(`PR: skipped — OAuth token request failed with HTTP ${tokenResponse.status}`)
    process.exit(1)
  }
  const { access_token: token } = await tokenResponse.json()
  const auth = { 'X-OAuth-Token': token }

  let branches: CandidateBranch[] | null = null
  let failed = false

  for (const id of claimed) {
    const taskResponse = await fetch(`${API}/api/v1/tasks/${encodeURIComponent(id)}`, { headers: auth })
    if (!taskResponse.ok) continue
    const body = await taskResponse.json()
    const task = body.task ?? body
    // Only finished work is up for review; a released or parked task's branch
    // is somewhere to resume from.
    if (!task?.completed) continue

    branches ??= unmergedBranches(repo)
    const matches = branchesForCompletedTask(task.identifier, branches)
    if (matches.length === 0) {
      console.log(`  PR: ${task.identifier} — completed, but no unmerged branch carries its id (nothing to open)`)
      continue
    }

    const commentsResponse = await fetch(`${API}/api/v1/tasks/${task.id}/comments`, { headers: auth })
    const comments: Array<{ authorId?: string | null; content?: string | null; createdAt?: string }> =
      commentsResponse.ok ? ((await commentsResponse.json()).comments ?? []) : []
    const report = comments
      .filter(comment => comment.authorId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .at(-1)?.content ?? null

    for (const branch of matches) {
      try {
        const existing = JSON.parse(
          run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,url'], repo),
        ) as Array<{ number: number; state: string; url: string }>
        if (existing.length > 0) {
          console.log(`  PR: ${task.identifier} — ${branch} already has #${existing[0].number} (${existing[0].state.toLowerCase()})`)
          continue
        }
        if (dryRun) {
          console.log(`  PR: ${task.identifier} — would open one for ${branch} [dry run]`)
          continue
        }
        const url = run('gh', [
          'pr', 'create', '--base', 'main', '--head', branch,
          '--title', prTitle(task),
          '--body', prBody({ task, taskUrl: `${API}/task/${task.id}`, report }),
        ], repo).trim().split('\n').at(-1)
        console.log(`  PR: ${task.identifier} — opened ${url} for ${branch}`)
      } catch (error) {
        failed = true
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
        console.log(`  PR: FAILED ${task.identifier} — ${branch}: ${message}`)
      }
    }
  }

  if (failed) process.exit(3)
}

main().catch(error => {
  console.error(`PR: failed — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
