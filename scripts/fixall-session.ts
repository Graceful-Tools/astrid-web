#!/usr/bin/env tsx
/**
 * Take, release, or inspect the /fixall lock on THIS working tree.
 *
 *   npx tsx scripts/fixall-session.ts acquire --pid $PPID --harness claude-code
 *   npx tsx scripts/fixall-session.ts status
 *   npx tsx scripts/fixall-session.ts release --pid $PPID
 *
 * PASS `$PPID`, NOT THE SCRIPT'S OWN PID. The lock is only useful if it names a
 * process that outlives the command that took it, and this script exits in
 * milliseconds. Inside an agent's shell `$PPID` is the harness session itself
 * (verified: the Bash tool's shell is a direct child of the `claude` binary), so
 * the lock dies exactly when the session does. `process.pid` here would be tsx,
 * and every lock would read as stale to the next caller.
 *
 * Exit codes are the interface, because the caller is a loop:
 *   0  the tree is yours
 *   2  another live session holds it — DO NOT proceed; work in a worktree
 *   1  something went wrong
 *
 * 2 rather than 1 for "held" mirrors scripts/claim-fixall-task.ts, where 2 is
 * likewise "someone else got there first, skip without complaining".
 */

import { execFileSync } from 'node:child_process'
import {
  acquireFixallSession,
  releaseFixallSession,
  readFixallSession,
  isProcessAlive,
} from './lib/fixall-session-lock'

const HELD_EXIT_CODE = 2

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main(): void {
  const command = process.argv[2]
  if (!command || !['acquire', 'release', 'status'].includes(command)) {
    console.error('Usage: fixall-session.ts <acquire|release|status> [--pid <pid>] [--harness <name>]')
    process.exit(1)
  }

  // --absolute-git-dir, so the lock path does not depend on the cwd the loop
  // happened to call from. In a linked worktree this is .git/worktrees/<name>,
  // which is what makes the lock per WORKING TREE rather than per repository.
  const gitDir = git('rev-parse', '--absolute-git-dir')
  const worktree = git('rev-parse', '--show-toplevel')

  if (command === 'status') {
    const held = readFixallSession(gitDir)
    if (!held) {
      console.log(`No /fixall session holds ${worktree}`)
      return
    }
    const liveness = isProcessAlive(held.pid) ? 'live' : 'STALE (holder is gone)'
    console.log(
      `${held.harness} (pid ${held.pid}, ${liveness}) has held ${held.worktree} since ${held.startedAt}`,
    )
    return
  }

  const pid = Number(flag('pid'))
  if (!Number.isFinite(pid) || pid <= 0) {
    console.error('--pid is required and must be a process id. Pass $PPID from the agent shell.')
    process.exit(1)
  }

  if (command === 'release') {
    const outcome = releaseFixallSession({ gitDir, pid })
    if (outcome.status === 'held-by-other') {
      console.error(
        `Not released: ${outcome.by.harness} (pid ${outcome.by.pid}) holds this tree, not pid ${pid}.`,
      )
      process.exit(1)
    }
    console.log(outcome.status === 'released' ? `Released ${worktree}` : `No lock on ${worktree}`)
    return
  }

  const outcome = acquireFixallSession({
    gitDir,
    pid,
    harness: flag('harness') ?? 'unknown',
    worktree,
    now: new Date(),
    isProcessAlive,
  })

  if (outcome.status === 'held') {
    const { by } = outcome
    console.error(
      [
        `REFUSED: ${by.harness} (pid ${by.pid}) has been running /fixall in this working tree since ${by.startedAt}.`,
        '',
        'Two /fixall sessions in one checkout overwrite each other: on 2026-09-09 one',
        "moved HEAD under the other's uncommitted work and both wrote the same fix.",
        '',
        'Parallel runs are fine — they just need their own tree:',
        '',
        '    npm run work:start <task-slug>',
        '',
        'then run /fixall from there. If that session is gone, this lock clears itself',
        'as soon as its process does; check with `fixall-session.ts status`.',
      ].join('\n'),
    )
    process.exit(HELD_EXIT_CODE)
  }

  if (outcome.status === 'reclaimed') {
    console.log(
      `Reclaimed ${worktree} from ${outcome.stale.harness} (pid ${outcome.stale.pid}, no longer running)`,
    )
    return
  }

  console.log(
    outcome.status === 'reacquired'
      ? `Still holding ${worktree} (pid ${pid})`
      : `Acquired ${worktree} (pid ${pid})`,
  )
}

main()
