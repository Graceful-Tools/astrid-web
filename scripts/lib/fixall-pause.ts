/**
 * Stand the scheduled /fixall loops down while someone is working (AWTD-1212).
 *
 * WHAT THE LOCK ALREADY DOES, AND WHAT IT MISSES. The working-tree lock
 * (lib/fixall-session-lock.ts) stops two sessions editing ONE checkout. The
 * collision it cannot see is the machine: on 2026-10-11 a session worked
 * astrid-web while the iOS loop ran a simulator suite and the web loop ran
 * predeploy, and the 5-minute load average peaked over 890. That is how two
 * runs ended up red on test timeouts in files that pass alone, filing failure
 * tasks for nothing (AWTD-1192, AWTD-1197). The lock is per tree and per repo;
 * contention is per Mac.
 *
 * TWO WAYS IN, DELIBERATELY DIFFERENT.
 *
 *   A LIVE HOLDER is registered by an interactive `fixall-session.ts acquire`
 *   and is keyed on PROCESS LIVENESS, not a timeout — the same probe the lock
 *   uses, for the same reason: a human's session may legitimately sit on one
 *   hard task for hours, and a pause that expired underneath it would be worse
 *   than none. It needs no resume step, because a dead session holds nothing.
 *
 *   AN EXPLICIT PAUSE covers what no session knows about — plain Xcode, a
 *   manual build — and is therefore the dangerous one: nothing dies to clear
 *   it. So it is ALWAYS bounded (DEFAULT_PAUSE_MINUTES, hard-capped at
 *   MAX_PAUSE_MINUTES) and always expires on its own. An unbounded silent mute
 *   is precisely the 2026-10-09 outage, where a live session held the web
 *   checkout for 15½ hours and the loop worked one task in 48 ticks without
 *   saying so (AWTD-1207).
 *
 * THE LOOPS REGISTER TOO, AND MUST NOT PAUSE THEMSELVES. Both loops call the
 * same acquire, so each would otherwise read its own registration and stand
 * down forever. `shouldYield` ignores `selfPid`, and the loops pass
 * `--scheduled` so they register without publishing a pause at all.
 *
 * Pure but for the files it is about: liveness and the clock are injected, so
 * every branch is tested in tests/scripts/fixall-pause.test.ts without
 * spawning a process or waiting on a timeout.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default window for an explicit pause: long enough for a work session. */
export const DEFAULT_PAUSE_MINUTES = 120
/** Hard cap. Past this, say so and clamp — never honour "forever". */
export const MAX_PAUSE_MINUTES = 480

/** A harness that is working on this machine right now. */
export interface FixallHolder {
  pid: number
  harness: string
  worktree: string
  startedAt: string
}

/** A deliberate, bounded pause taken by a person. */
export interface FixallPause {
  until: string
  who: string
  reason: string
  createdAt: string
  minutes: number
  /** True when the request was longer than MAX_PAUSE_MINUTES and was clamped. */
  capped?: boolean
}

export type YieldVerdict = { yield: false } | { yield: true; reason: string }

/**
 * Machine-local, and NOT repo state: both loops and every session on this Mac
 * read the same directory, and it must survive `npm ci`. Same choice, and the
 * same reasoning, as lib/fixall-seen-file.ts.
 */
export function defaultFixallStateDir(platform: NodeJS.Platform = process.platform): string {
  const cacheDir =
    platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches')
      : process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(cacheDir, 'astrid-fixall')
}

const holdersDir = (stateDir: string) => join(stateDir, 'holders')
const holderPath = (stateDir: string, pid: number) => join(holdersDir(stateDir), `${pid}.json`)
const pausePath = (stateDir: string) => join(stateDir, 'pause.json')

export function registerHolder(input: {
  stateDir: string
  pid: number
  harness: string
  worktree: string
  now: Date
}): FixallHolder {
  const { stateDir, pid, harness, worktree, now } = input
  const holder: FixallHolder = { pid, harness, worktree, startedAt: now.toISOString() }
  mkdirSync(holdersDir(stateDir), { recursive: true })
  writeFileSync(holderPath(stateDir, pid), `${JSON.stringify(holder, null, 2)}\n`, 'utf8')
  return holder
}

/** Only ever its own: clearing someone else's would reintroduce the collision. */
export function unregisterHolder(input: { stateDir: string; pid: number }): void {
  rmSync(holderPath(input.stateDir, input.pid), { force: true })
}

/**
 * Everyone working right now. A registration whose process is gone — or that
 * will not parse — is deleted as it is read: a session killed mid-run must not
 * leave a pause behind that only a human can find, and a corrupt file that
 * jammed every later tick would be a worse outage than the contention this
 * prevents.
 */
export function liveHolders(input: {
  stateDir: string
  isProcessAlive: (pid: number) => boolean
}): FixallHolder[] {
  const { stateDir, isProcessAlive } = input
  const dir = holdersDir(stateDir)
  if (!existsSync(dir)) return []

  const live: FixallHolder[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    let holder: FixallHolder | null = null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FixallHolder>
      if (typeof parsed?.pid === 'number' && Number.isFinite(parsed.pid)) {
        holder = {
          pid: parsed.pid,
          harness: typeof parsed.harness === 'string' ? parsed.harness : 'unknown',
          worktree: typeof parsed.worktree === 'string' ? parsed.worktree : '',
          startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
        }
      }
    } catch {
      holder = null
    }

    if (!holder || !isProcessAlive(holder.pid)) {
      rmSync(path, { force: true })
      continue
    }
    live.push(holder)
  }
  return live.sort((a, b) => a.pid - b.pid)
}

export function writePause(input: {
  stateDir: string
  minutes: number | undefined
  who: string
  reason: string
  now: Date
}): FixallPause {
  const { stateDir, who, reason, now } = input
  const asked = input.minutes ?? DEFAULT_PAUSE_MINUTES
  const minutes = Math.min(Math.max(1, Math.round(asked)), MAX_PAUSE_MINUTES)
  const pause: FixallPause = {
    until: new Date(now.getTime() + minutes * 60_000).toISOString(),
    who,
    reason,
    createdAt: now.toISOString(),
    minutes,
    ...(minutes < asked ? { capped: true } : {}),
  }
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(pausePath(stateDir), `${JSON.stringify(pause, null, 2)}\n`, 'utf8')
  return pause
}

/** The pause in force, or null — expired, absent and unreadable all read as null. */
export function readPause(input: { stateDir: string; now: Date }): FixallPause | null {
  const path = pausePath(input.stateDir)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FixallPause>
    if (typeof parsed?.until !== 'string') return null
    const until = new Date(parsed.until)
    if (Number.isNaN(until.getTime()) || until.getTime() <= input.now.getTime()) return null
    return {
      until: parsed.until,
      who: typeof parsed.who === 'string' ? parsed.who : 'unknown',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      minutes: typeof parsed.minutes === 'number' ? parsed.minutes : 0,
      ...(parsed.capped ? { capped: true } : {}),
    }
  } catch {
    return null
  }
}

export function clearPause(input: { stateDir: string }): void {
  rmSync(pausePath(input.stateDir), { force: true })
}

/**
 * Should this scheduled tick stand down? The reason is written for the log line
 * and the board alert, so it names who, where, and how long is left.
 */
export function shouldYield(input: {
  stateDir: string
  now: Date
  selfPid: number
  isProcessAlive: (pid: number) => boolean
}): YieldVerdict {
  const { stateDir, now, selfPid, isProcessAlive } = input

  const pause = readPause({ stateDir, now })
  if (pause) {
    const left = Math.max(1, Math.round((new Date(pause.until).getTime() - now.getTime()) / 60_000))
    const because = pause.reason ? `: ${pause.reason}` : ''
    return {
      yield: true,
      reason: `paused by ${pause.who}${because} — ${left} minute(s) left, then it resumes on its own`,
    }
  }

  const others = liveHolders({ stateDir, isProcessAlive }).filter(h => h.pid !== selfPid)
  if (others.length > 0) {
    const h = others[0]
    const more = others.length > 1 ? ` (+${others.length - 1} more)` : ''
    return {
      yield: true,
      reason: `${h.harness} (pid ${h.pid}) is working ${h.worktree}${more} — this tick stands down`,
    }
  }

  return { yield: false }
}
