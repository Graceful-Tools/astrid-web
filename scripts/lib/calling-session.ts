/**
 * Identify THIS session — the one running the script — for attribution.
 *
 * Task 8ee7e873. The previous implementation listed ~/.claude/sessions, sorted
 * by mtime and took the newest, calling it "the current session". It is the
 * current session only when exactly one is running; with two, it is whichever
 * one last drew breath. Jon hit that on 2026-08-17: a session link posted from
 * one session named another that had never touched the task.
 *
 * The state on this machine while the fix was written shows why it matters
 * beyond tidiness — the newest session file was:
 *
 *   {"pid":93925,"name":"astrid-ios-38","cwd":".../astrid-ios", ...}
 *
 * i.e. the PEER LOOP working the other repo. Attribution would have crossed
 * exactly the boundary /fixall is written to keep, on the board both loops read.
 *
 * So this asks the environment instead of guessing:
 *
 *   CLAUDE_CODE_BRIDGE_SESSION_ID — the calling session's bridge id, exact
 *   CLAUDE_PID                    — names this session's own file, <pid>.json
 *
 * NULL IS A RESULT, not a failure to handle. A session link is a claim about
 * who is working a task, so when neither signal is available the caller must
 * post nothing. Guessing produces a confident, wrong claim; silence produces a
 * task nobody has claimed, which is true.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

export interface CallingSession {
  bridgeSessionId: string
  name: string
}

const DEFAULT_NAME = 'Claude Code Session'

/** This session's own file, or null. Never another session's. */
function readOwnSessionFile(
  homeDir: string,
  pid: string | undefined,
): { bridgeSessionId?: string; name?: string } | null {
  if (!pid) return null

  const file = path.join(homeDir, '.claude', 'sessions', `${pid}.json`)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    // Missing, unreadable or corrupt. All three mean "cannot confirm", and the
    // one thing never to do here is widen the search to other files.
    return null
  }
}

export function resolveCallingSession({
  env = process.env,
  homeDir = os.homedir(),
}: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  homeDir?: string
} = {}): CallingSession | null {
  const own = readOwnSessionFile(homeDir, env.CLAUDE_PID?.trim())

  // The env var wins: it is the calling process's own id, with no file lookup
  // to get wrong. The file supplies the human-readable name when it can.
  const bridgeSessionId = env.CLAUDE_CODE_BRIDGE_SESSION_ID?.trim() || own?.bridgeSessionId

  if (!bridgeSessionId) return null

  return { bridgeSessionId, name: own?.name || DEFAULT_NAME }
}

/**
 * The URL a session id points at.
 *
 * `/code/sessions/<id>` was wrong on a second axis: the ids are already shaped
 * `session_01QM…`, and the links the harness itself emits (commit trailers, PR
 * bodies) are `https://claude.ai/code/session_01QM…` with no extra segment.
 */
export function sessionUrl(bridgeSessionId: string): string {
  return `https://claude.ai/code/${bridgeSessionId}`
}
