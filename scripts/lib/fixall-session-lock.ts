/**
 * One /fixall session per working tree.
 *
 * WHAT WENT WRONG. On 2026-09-09 two Claude Code /fixall sessions ran against the
 * same checkout. The second created a branch, which moved `HEAD` under the first
 * while it had six files uncommitted, and both then independently wrote the same
 * fix for AWTD-865. Neither noticed the other until a `git status` came back with
 * files nobody in that session had touched.
 *
 * WHY THE BOARD HANDSHAKE DID NOT CATCH IT. `Ready` -> `Doing` claims a TASK. It
 * says nothing about which WORKING TREE a session is editing, and the collision
 * is over files, not over rows: two sessions working two DIFFERENT tasks in one
 * checkout corrupt each other exactly as thoroughly. The lanes and this lock
 * answer different questions and neither substitutes for the other.
 *
 * KEYED TO THE GIT DIRECTORY, NOT THE REPOSITORY. `git rev-parse --git-dir`
 * answers `.git` in the primary checkout and `.git/worktrees/<name>` in a linked
 * worktree. Keying on it means parallel /fixall runs in separate worktrees never
 * see each other — which is the arrangement we want, and the one the fix steers
 * people toward — while two runs in one tree collide on the first call.
 *
 * STALENESS IS LIVENESS, NOT AGE. A killed session must not wedge its checkout
 * forever, so a lock whose holder is gone is reclaimed. It is decided by whether
 * the pid is alive rather than by a timeout, because a /fixall run can
 * legitimately sit on one hard task for a long time and a lock that expires
 * underneath a working session is worse than no lock at all.
 *
 * ADVISORY, NOT MANDATORY. This is a cooperating-agents guard, not a security
 * boundary: anything that declines to call it is unaffected. The failure it
 * prevents is two well-behaved loops that simply could not see one another.
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Who holds a working tree, and since when. */
export interface FixallSessionLock {
  /** OS process id of the holding session — the liveness probe. */
  pid: number
  /** Which harness holds it (`claude-code`, `github-copilot`, `codex`). */
  harness: string
  /** Absolute path of the working tree, for a human reading the error. */
  worktree: string
  /** ISO timestamp, for the same reason. */
  startedAt: string
}

export type AcquireOutcome =
  | { status: 'acquired'; lock: FixallSessionLock }
  /** The same pid asked again — a resumed session, not a competitor. */
  | { status: 'reacquired'; lock: FixallSessionLock }
  /** The previous holder is gone; its lock was taken over. */
  | { status: 'reclaimed'; lock: FixallSessionLock; stale: FixallSessionLock }
  /** Someone else is live in this tree. The caller must NOT proceed. */
  | { status: 'held'; by: FixallSessionLock }

export type ReleaseOutcome =
  | { status: 'released' }
  | { status: 'not-held' }
  | { status: 'held-by-other'; by: FixallSessionLock }

/**
 * Inside the git directory, so `git worktree remove` takes the lock with it and
 * a stale file cannot outlive the tree it describes.
 */
export function fixallLockPath(gitDir: string): string {
  return join(gitDir, 'fixall-session.json')
}

/**
 * The lock currently on this working tree, or null.
 *
 * A file that will not parse answers null. A corrupt lock that jammed every
 * future run would be a worse outage than the collision this prevents, and the
 * file is a coordination hint rather than a record of anything irreplaceable.
 */
export function readFixallSession(gitDir: string): FixallSessionLock | null {
  const path = fixallLockPath(gitDir)
  if (!existsSync(path)) return null

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FixallSessionLock>
    if (typeof parsed?.pid !== 'number' || !Number.isFinite(parsed.pid)) return null
    return {
      pid: parsed.pid,
      harness: typeof parsed.harness === 'string' ? parsed.harness : 'unknown',
      worktree: typeof parsed.worktree === 'string' ? parsed.worktree : '',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    }
  } catch {
    return null
  }
}

export function acquireFixallSession(input: {
  gitDir: string
  pid: number
  harness: string
  worktree: string
  now: Date
  /** Injected so the stale-holder path is testable without killing a process. */
  isProcessAlive: (pid: number) => boolean
}): AcquireOutcome {
  const { gitDir, pid, harness, worktree, now, isProcessAlive } = input
  const existing = readFixallSession(gitDir)

  const mine: FixallSessionLock = {
    pid,
    harness,
    worktree,
    startedAt: now.toISOString(),
  }

  if (!existing) {
    write(gitDir, mine)
    return { status: 'acquired', lock: mine }
  }

  if (existing.pid === pid) {
    write(gitDir, mine)
    return { status: 'reacquired', lock: mine }
  }

  if (isProcessAlive(existing.pid)) {
    return { status: 'held', by: existing }
  }

  write(gitDir, mine)
  return { status: 'reclaimed', lock: mine, stale: existing }
}

/**
 * Only the holder may release.
 *
 * A session that could clear someone else's lock would reintroduce the bug on
 * the way out — the 2026-09-09 collision ended with one session tidying up
 * state the other still depended on.
 */
export function releaseFixallSession(input: { gitDir: string; pid: number }): ReleaseOutcome {
  const { gitDir, pid } = input
  const existing = readFixallSession(gitDir)

  if (!existing) return { status: 'not-held' }
  if (existing.pid !== pid) return { status: 'held-by-other', by: existing }

  rmSync(fixallLockPath(gitDir), { force: true })
  return { status: 'released' }
}

/** Is this pid live? The default probe; signal 0 tests existence without signalling. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists and belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function write(gitDir: string, lock: FixallSessionLock): void {
  writeFileSync(fixallLockPath(gitDir), `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}
