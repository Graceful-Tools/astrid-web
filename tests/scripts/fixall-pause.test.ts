/**
 * RED for "pause the background loops while someone is working" (AWTD-1212).
 *
 * WHY THE LOCK IS NOT ALREADY THIS. Guard 1 stands down for a live session in
 * the SAME working tree. The collision it misses is machine contention across
 * repos: on 2026-10-11 a session worked astrid-web while the iOS loop ran a
 * simulator suite and the web loop ran predeploy, and the 5-minute load average
 * peaked over 890 — which is how two runs end up red on test timeouts in
 * unrelated files (AWTD-1192, AWTD-1197).
 *
 * TWO WAYS IN, ONE WAY OUT. A live holder is registered by the interactive
 * acquire and self-clears when that process dies: no TTL to get wrong, same
 * liveness probe the lock itself uses. An explicit pause covers work outside a
 * session (plain Xcode, a manual build) and is always bounded — an unbounded
 * silent mute is exactly the 2026-10-09 outage this must not recreate.
 *
 * Liveness and the clock are injected so every branch is testable without
 * spawning processes or waiting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  registerHolder,
  unregisterHolder,
  liveHolders,
  writePause,
  readPause,
  clearPause,
  shouldYield,
  MAX_PAUSE_MINUTES,
  DEFAULT_PAUSE_MINUTES,
} from '@/scripts/lib/fixall-pause'

let dir: string
const alive = (pids: number[]) => (pid: number) => pids.includes(pid)
const NOW = new Date('2026-10-11T15:00:00Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixall-pause-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('a working session registers itself machine-wide', () => {
  it('registers a holder and reads it back', () => {
    registerHolder({ stateDir: dir, pid: 111, harness: 'claude-code', worktree: '/w/web', now: NOW })
    const holders = liveHolders({ stateDir: dir, isProcessAlive: alive([111]) })
    expect(holders).toHaveLength(1)
    expect(holders[0]).toMatchObject({ pid: 111, harness: 'claude-code', worktree: '/w/web' })
  })

  it('ignores a holder whose process is gone, and cleans the file up', () => {
    registerHolder({ stateDir: dir, pid: 111, harness: 'claude-code', worktree: '/w/web', now: NOW })
    registerHolder({ stateDir: dir, pid: 222, harness: 'claude-code', worktree: '/w/ios', now: NOW })

    const holders = liveHolders({ stateDir: dir, isProcessAlive: alive([222]) })
    expect(holders.map(h => h.pid)).toEqual([222])
    // A session that died without releasing must not need a human to tidy up.
    expect(liveHolders({ stateDir: dir, isProcessAlive: alive([222]) })).toHaveLength(1)
  })

  it('releases only its own registration', () => {
    registerHolder({ stateDir: dir, pid: 111, harness: 'claude-code', worktree: '/w/web', now: NOW })
    registerHolder({ stateDir: dir, pid: 222, harness: 'claude-code', worktree: '/w/ios', now: NOW })
    unregisterHolder({ stateDir: dir, pid: 111 })
    expect(liveHolders({ stateDir: dir, isProcessAlive: alive([111, 222]) }).map(h => h.pid)).toEqual([222])
  })

  it('survives a corrupt registration rather than jamming every later tick', () => {
    mkdirSync(join(dir, 'holders'), { recursive: true })
    writeFileSync(join(dir, 'holders', '999.json'), '{not json', 'utf8')
    expect(() => liveHolders({ stateDir: dir, isProcessAlive: alive([999]) })).not.toThrow()
    expect(liveHolders({ stateDir: dir, isProcessAlive: alive([999]) })).toHaveLength(0)
  })
})

describe('an explicit pause is always bounded', () => {
  it('defaults to a sensible window rather than forever', () => {
    const pause = writePause({ stateDir: dir, minutes: undefined, who: 'jon', reason: 'xcode', now: NOW })
    expect(pause.minutes).toBe(DEFAULT_PAUSE_MINUTES)
    expect(new Date(pause.until).getTime()).toBe(NOW.getTime() + DEFAULT_PAUSE_MINUTES * 60_000)
  })

  it('caps a long request instead of honouring it', () => {
    const pause = writePause({ stateDir: dir, minutes: 10_000, who: 'jon', reason: 'holiday', now: NOW })
    expect(pause.minutes).toBe(MAX_PAUSE_MINUTES)
    expect(pause.capped).toBe(true)
  })

  it('expires on its own', () => {
    writePause({ stateDir: dir, minutes: 60, who: 'jon', reason: 'xcode', now: NOW })
    const later = new Date(NOW.getTime() + 61 * 60_000)
    expect(readPause({ stateDir: dir, now: NOW })).not.toBeNull()
    expect(readPause({ stateDir: dir, now: later })).toBeNull()
  })

  it('can be cleared early', () => {
    writePause({ stateDir: dir, minutes: 60, who: 'jon', reason: 'xcode', now: NOW })
    clearPause({ stateDir: dir })
    expect(readPause({ stateDir: dir, now: NOW })).toBeNull()
  })
})

describe('what a scheduled tick decides', () => {
  const ask = (pids: number[], now = NOW) =>
    shouldYield({ stateDir: dir, now, selfPid: 42, isProcessAlive: alive(pids) })

  it('runs when nobody is working', () => {
    expect(ask([]).yield).toBe(false)
  })

  it('stands down for a live session in ANOTHER repo', () => {
    registerHolder({ stateDir: dir, pid: 111, harness: 'claude-code', worktree: '/w/ios', now: NOW })
    const verdict = ask([111])
    expect(verdict.yield).toBe(true)
    // The reason reaches the log and the board alert, so it must name who and where.
    expect(verdict.reason).toContain('claude-code')
    expect(verdict.reason).toContain('/w/ios')
  })

  it('does not stand down for its own registration', () => {
    // The loops register as lock holders too; a loop must not pause itself.
    registerHolder({ stateDir: dir, pid: 42, harness: 'claude-code', worktree: '/w/web', now: NOW })
    expect(ask([42]).yield).toBe(false)
  })

  it('runs again once the session exits, with no cleanup step', () => {
    registerHolder({ stateDir: dir, pid: 111, harness: 'claude-code', worktree: '/w/ios', now: NOW })
    expect(ask([111]).yield).toBe(true)
    expect(ask([]).yield).toBe(false)
  })

  it('stands down for an explicit pause, and names its reason and expiry', () => {
    writePause({ stateDir: dir, minutes: 120, who: 'jon', reason: 'xcode profiling', now: NOW })
    const verdict = ask([])
    expect(verdict.yield).toBe(true)
    expect(verdict.reason).toContain('xcode profiling')
    expect(verdict.reason).toMatch(/\d+ minute/)
  })

  it('runs once that pause has expired, without anyone resuming it', () => {
    writePause({ stateDir: dir, minutes: 60, who: 'jon', reason: 'xcode', now: NOW })
    expect(ask([], new Date(NOW.getTime() + 61 * 60_000)).yield).toBe(false)
  })
})
