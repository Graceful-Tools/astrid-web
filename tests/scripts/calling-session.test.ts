/**
 * Which session is posting? (task 8ee7e873 — "post-session-link.ts posts the
 * wrong session's link")
 *
 * The old resolver read ~/.claude/sessions, sorted the files by mtime and took
 * the first — "the most recently active session", which is only the caller by
 * coincidence. Jon hit it on 2026-08-17 with two sessions running: the link
 * named a session that had never touched the task.
 *
 * Reproduced again while fixing it, and the failure is worse than cosmetic.
 * The newest session file on this machine belonged to `astrid-ios-38`, cwd
 * `astrid-web/../astrid-ios` — the PEER LOOP that /fixall exists to keep out of
 * this repo. Posting that link would have credited web work to the iOS agent,
 * on the task board both loops read.
 *
 * The environment already knows the answer, so the fix is to stop guessing:
 * `CLAUDE_CODE_BRIDGE_SESSION_ID` is the calling session's id, and
 * `CLAUDE_PID` names its own file. When neither is available the answer is
 * NULL and the caller posts nothing — a wrong link reads as a claim about who
 * is working the task, so silence is strictly better than a guess.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveCallingSession } from '../../scripts/lib/calling-session'

let home: string
let sessionsDir: string

/** Write a session file and stamp its mtime, so "newest" is deterministic. */
function writeSession(
  pid: number,
  fields: { bridgeSessionId?: string; name?: string; cwd?: string },
  mtimeSeconds: number,
) {
  const file = join(sessionsDir, `${pid}.json`)
  writeFileSync(file, JSON.stringify({ pid, ...fields }))
  utimesSync(file, mtimeSeconds, mtimeSeconds)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'astrid-session-'))
  sessionsDir = join(home, '.claude', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('resolveCallingSession', () => {
  it('takes the bridge id straight from the environment', () => {
    const session = resolveCallingSession({
      env: { CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_MINE', CLAUDE_PID: '111' },
      homeDir: home,
    })

    expect(session?.bridgeSessionId).toBe('session_MINE')
  })

  it('ignores a NEWER session belonging to someone else — the actual bug', () => {
    // Exactly the state observed on 2026-08-19: the peer iOS loop wrote last.
    writeSession(111, { bridgeSessionId: 'session_MINE', name: 'astrid-web-44' }, 1000)
    writeSession(222, { bridgeSessionId: 'session_THEIRS', name: 'astrid-ios-38' }, 9999)

    const session = resolveCallingSession({
      env: { CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_MINE', CLAUDE_PID: '111' },
      homeDir: home,
    })

    expect(session?.bridgeSessionId).toBe('session_MINE')
    expect(session?.name).toBe('astrid-web-44')
  })

  it('falls back to this process own session file, keyed by pid', () => {
    writeSession(111, { bridgeSessionId: 'session_MINE', name: 'astrid-web-44' }, 1000)
    writeSession(222, { bridgeSessionId: 'session_THEIRS', name: 'astrid-ios-38' }, 9999)

    const session = resolveCallingSession({ env: { CLAUDE_PID: '111' }, homeDir: home })

    expect(session?.bridgeSessionId).toBe('session_MINE')
  })

  it('returns null rather than borrow a stranger id when its own file is missing', () => {
    writeSession(222, { bridgeSessionId: 'session_THEIRS', name: 'astrid-ios-38' }, 9999)

    const session = resolveCallingSession({ env: { CLAUDE_PID: '111' }, homeDir: home })

    expect(session).toBeNull()
  })

  it('returns null when the environment says nothing at all', () => {
    writeSession(222, { bridgeSessionId: 'session_THEIRS', name: 'astrid-ios-38' }, 9999)

    expect(resolveCallingSession({ env: {}, homeDir: home })).toBeNull()
  })

  it('returns null when the sessions directory does not exist', () => {
    rmSync(join(home, '.claude'), { recursive: true, force: true })

    expect(resolveCallingSession({ env: { CLAUDE_PID: '111' }, homeDir: home })).toBeNull()
  })

  it('survives a corrupt session file instead of throwing mid-run', () => {
    writeFileSync(join(sessionsDir, '111.json'), 'not json at all')

    expect(resolveCallingSession({ env: { CLAUDE_PID: '111' }, homeDir: home })).toBeNull()
  })

  it('still resolves when its own file is corrupt but the env carries the id', () => {
    writeFileSync(join(sessionsDir, '111.json'), '{{{')

    const session = resolveCallingSession({
      env: { CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_MINE', CLAUDE_PID: '111' },
      homeDir: home,
    })

    expect(session?.bridgeSessionId).toBe('session_MINE')
    expect(session?.name, 'falls back to a generic name, not a stranger one').toBe(
      'Claude Code Session',
    )
  })

  it('does not treat a file with no bridge id as an answer', () => {
    // A session that has not registered with the bridge has no link to post.
    writeSession(111, { name: 'astrid-web-44' }, 1000)

    expect(resolveCallingSession({ env: { CLAUDE_PID: '111' }, homeDir: home })).toBeNull()
  })
})
