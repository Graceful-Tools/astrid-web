#!/usr/bin/env tsx
/**
 * Claim the first Ready task on the board that no other session has (ADEV-26).
 *
 * N cloud workers and any local sessions share the board and the `claude` mailbox, so
 * they all see the same top task. This walks the queue in priority order and claims; a
 * 409 (someone else won it) moves on to the next task instead of ending the run, and an
 * exhausted snapshot is re-read live before the answer is "nothing left". The rules are
 * in scripts/lib/claim-next.ts, where they are tested.
 *
 * Usage:
 *   npx tsx scripts/claim-next-fixall-task.ts --agent claude --list <board-id> \
 *     [--preflight .agent-output/preflight.json] [--no-core]
 *
 * A core task (titled `[core]` or naming astrid-core) is passed over with `--no-core`, or
 * when the runner found it cannot push to astrid-core (`ASTRID_CORE_PUSH=0`).
 *
 * A task whose identifier is in the head branch of an open PR is passed over too (ADEV-310):
 * its work exists, and a lapsed lease is no reason to build it twice. A task sent back to be
 * resumed from that branch (a rework or a release) is still claimed. The PR lookup is
 * `gh pr list` and fails open: if it errors, claiming goes on without the guard.
 *
 * Exit codes, matching claim-fixall-task.ts and agent-queue-status.ts:
 *   0  `CLAIMED <id> <identifier> — <title>`: the task is this session's, in Doing. When the
 *      runner already claimed one for this worker (`ASTRID_CLAIMED_TASK`), that one, unasked.
 *   3  `NO_READY_TASK`: every Ready task is taken or skipped — say RESULT: SKIPPED
 *   1  could not tell (auth, network, a non-409 refusal). Not the same as empty.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { loadScriptEnv } from './lib/load-env'
import {
  claimNextReady,
  isCoreCandidate,
  openPrBranches,
  runnerClaimedTask,
  skipTasksWithOpenPr,
  type ClaimCandidate,
} from './lib/claim-next'
import { recordClaim, requestFixallClaim } from './lib/fixall-claim-request'
import { scriptClient } from './lib/script-client'
import { FIXALL_CLAIM_MAILBOXES } from '@/lib/fixall-claim'

loadScriptEnv()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

function snapshotQueue(path: string): ClaimCandidate[] {
  if (!existsSync(path)) return []
  try {
    const queue = JSON.parse(readFileSync(path, 'utf8'))?.snapshot?.queue
    return Array.isArray(queue) ? queue : []
  } catch {
    // An unreadable snapshot only costs the first pass; the live read still runs.
    return []
  }
}

async function main() {
  const agent = arg('--agent')
  const listId = arg('--list')
  const preflight = arg('--preflight') ?? '.agent-output/preflight.json'
  const noCore = process.argv.includes('--no-core') || process.env.ASTRID_CORE_PUSH === '0'
  if (!agent || !FIXALL_CLAIM_MAILBOXES.includes(agent) || !listId) {
    console.error('Usage: claim-next-fixall-task.ts --agent <mailbox> --list <board-id> [--preflight <file>] [--no-core]')
    process.exit(1)
  }
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required')
    process.exit(1)
  }

  // The runner claimed this worker's task before the session started (ADEV-75). It is
  // already ours, in Doing; re-walking the queue would answer NO_READY_TASK for it.
  const held = runnerClaimedTask(process.env)
  if (held) {
    console.log(`CLAIMED ${held} — already claimed for this worker by the runner; work it`)
    return
  }

  const client = scriptClient({ clientId, clientSecret })
  const refresh = async (): Promise<ClaimCandidate[]> => {
    const { queue } = await client.getQueue({ agent, listId, includeUnassigned: true })
    return Array.isArray(queue) ? (queue as unknown as ClaimCandidate[]) : []
  }

  const log = (line: string) => console.error(line)
  // Read once per run: the open PRs do not change in the seconds a walk takes.
  const branches = openPrBranches(() => {
    const repo = process.env.GITHUB_REPOSITORY
    const out = execFileSync(
      'gh',
      ['pr', 'list', ...(repo ? ['--repo', repo] : []), '--state', 'open', '--limit', '500', '--json', 'headRefName', '--jq', '.[].headRefName'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
    )
    return out.split('\n').map(line => line.trim())
  }, log)

  const result = await claimNextReady({
    initial: snapshotQueue(preflight),
    refresh,
    skip: skipTasksWithOpenPr({
      openBranches: branches,
      comments: task => client.getComments(task.id),
      log,
      otherwise: noCore ? isCoreCandidate : undefined,
    }),
    claim: async task => {
      const attempt = await requestFixallClaim({ client, taskId: task.id, action: 'ready', agent, listId })
      if (attempt.status === 'conflict' && attempt.reason) console.error(`  server said: ${attempt.reason}`)
      return attempt.status
    },
    log,
  })

  if (!result.claimed) {
    console.log(
      `NO_READY_TASK: nothing left to claim (${result.conflicts.length} taken by peers` +
        `${result.skipped.length ? `, ${result.skipped.length} skipped (core, or an open PR)` : ''})`,
    )
    process.exit(3)
  }
  recordClaim(result.claimed.id, 'ready')
  console.log(`CLAIMED ${result.claimed.id} ${result.claimed.identifier ?? ''} — ${result.claimed.title ?? ''}`)
}

main().catch(error => {
  console.error(`Claim failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
