/**
 * RED for the /fixall collision fix.
 *
 * On 2026-09-09 two Claude Code /fixall sessions ran against ONE checkout. The
 * second created a branch, which moved `HEAD` under the first while it had six
 * files uncommitted, and both then wrote the same fix for AWTD-865. Nothing in
 * the loop noticed: the board handshake (`Ready` -> `Doing`) says which TASK is
 * claimed and says nothing about which WORKING TREE is in use.
 *
 * So the lock is keyed to the git directory, not the repository. `git rev-parse
 * --git-dir` answers `.git` in the primary checkout and `.git/worktrees/<name>`
 * in a linked worktree, so two sessions in two worktrees of the same repo hold
 * two independent locks and never see each other — which is the arrangement we
 * WANT — while two sessions in one tree collide immediately, which is the one
 * we do not.
 *
 * Liveness is injected rather than read from the host so these tests can assert
 * the stale-holder path without spawning and killing a real process.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireFixallSession,
  releaseFixallSession,
  readFixallSession,
  fixallLockPath,
} from '@/scripts/lib/fixall-session-lock'

const now = new Date('2026-09-09T05:30:00.000Z')
const alive = (pids: number[]) => (pid: number) => pids.includes(pid)

let gitDir: string
let otherGitDir: string

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), 'fixall-lock-'))
  otherGitDir = mkdtempSync(join(tmpdir(), 'fixall-lock-other-'))
})
afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true })
  rmSync(otherGitDir, { recursive: true, force: true })
})

function acquire(dir: string, pid: number, livePids: number[], harness = 'claude-code') {
  return acquireFixallSession({
    gitDir: dir,
    pid,
    harness,
    worktree: `/repo/${harness}`,
    now,
    isProcessAlive: alive(livePids),
  })
}

describe('fixall session lock', () => {
  it('acquires an unheld checkout', () => {
    const outcome = acquire(gitDir, 100, [100])

    expect(outcome.status).toBe('acquired')
    expect(readFixallSession(gitDir)).toMatchObject({ pid: 100, harness: 'claude-code' })
  })

  it('REFUSES a second live session in the same checkout, and names the holder', () => {
    // This is the failure of 2026-09-09, reduced to one assertion.
    acquire(gitDir, 100, [100, 200])
    const outcome = acquire(gitDir, 200, [100, 200])

    expect(outcome.status).toBe('held')
    if (outcome.status !== 'held') throw new Error('unreachable')
    expect(outcome.by.pid).toBe(100)
    // The holder must stay the holder: a refused claim writes nothing.
    expect(readFixallSession(gitDir)?.pid).toBe(100)
  })

  it('lets two sessions in DIFFERENT worktrees of one repo both proceed', () => {
    // The point of the fix is isolation, not serialisation. Parallel /fixall runs
    // are fine and desirable; they just may not share a working tree.
    expect(acquire(gitDir, 100, [100, 200]).status).toBe('acquired')
    expect(acquire(otherGitDir, 200, [100, 200]).status).toBe('acquired')
  })

  it('is idempotent for the holder, so a resumed session is not locked out of its own tree', () => {
    acquire(gitDir, 100, [100])
    const outcome = acquire(gitDir, 100, [100])

    expect(outcome.status).toBe('reacquired')
  })

  it('reclaims a lock whose holder is gone', () => {
    // A killed session must not wedge its checkout forever. Staleness is decided
    // by whether the pid is alive, not by an age heuristic — a /fixall run can
    // legitimately sit on one task for a long time.
    acquire(gitDir, 100, [100])
    const outcome = acquire(gitDir, 200, [200])

    expect(outcome.status).toBe('reclaimed')
    if (outcome.status !== 'reclaimed') throw new Error('unreachable')
    expect(outcome.stale.pid).toBe(100)
    expect(readFixallSession(gitDir)?.pid).toBe(200)
  })

  it('treats a corrupt lock file as free rather than jamming the loop forever', () => {
    writeFileSync(fixallLockPath(gitDir), '{ not json', 'utf8')

    expect(acquire(gitDir, 100, [100]).status).toBe('acquired')
  })

  it('releases only for the holder', () => {
    acquire(gitDir, 100, [100, 200])

    const byStranger = releaseFixallSession({ gitDir, pid: 200 })
    expect(byStranger.status).toBe('held-by-other')
    expect(existsSync(fixallLockPath(gitDir))).toBe(true)

    const byHolder = releaseFixallSession({ gitDir, pid: 100 })
    expect(byHolder.status).toBe('released')
    expect(readFixallSession(gitDir)).toBeNull()
  })

  it('reports not-held when releasing a checkout nobody locked', () => {
    expect(releaseFixallSession({ gitDir, pid: 100 }).status).toBe('not-held')
  })

  it('keeps the lock inside the git directory it was given', () => {
    // Encodes the keying decision: per WORKING TREE, because that is the unit
    // two sessions actually fight over.
    expect(fixallLockPath(gitDir).startsWith(gitDir)).toBe(true)
    expect(fixallLockPath(gitDir)).not.toBe(fixallLockPath(otherGitDir))
  })
})
