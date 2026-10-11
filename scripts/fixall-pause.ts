#!/usr/bin/env tsx
/**
 * Pause, resume, or inspect the scheduled /fixall loops on THIS Mac (AWTD-1212).
 *
 * For work the loops cannot see: plain Xcode, a manual build, a profiling run —
 * anything that buries the machine without taking the working-tree lock. A
 * Claude session does not need this; its `fixall-session.ts acquire` already
 * pauses both loops for as long as it lives.
 *
 *   npm run fixall:pause                 # 2h, the default
 *   npm run fixall:pause -- 45m "xcode profiling"
 *   npm run fixall:pause -- status
 *   npm run fixall:resume
 *
 * The loops ask with `yield --self-pid $$`, whose EXIT CODE is the interface,
 * because the caller is a shell guard:
 *
 *   0  nothing is paused — run
 *   2  stand down; the one-line reason is on stdout, for the log and the alert
 *   1  the state could not be read — the loop runs anyway and says so, because
 *      a loop that stalls on an unreadable pause file is a worse outage than
 *      one run too many (the same choice guard 2b makes about the load)
 *
 * ALWAYS BOUNDED. Nothing dies to clear an explicit pause, so it carries an
 * expiry and is capped at MAX_PAUSE_MINUTES. The failure this must not
 * recreate is 2026-10-09, when the web loop was muted for 15½ hours and worked
 * one task in 48 ticks without saying so (AWTD-1207).
 */
import { execFileSync } from 'node:child_process'
import {
  DEFAULT_PAUSE_MINUTES,
  MAX_PAUSE_MINUTES,
  clearPause,
  defaultFixallStateDir,
  liveHolders,
  readPause,
  shouldYield,
  writePause,
} from './lib/fixall-pause'
import { isProcessAlive } from './lib/fixall-session-lock'

/** 2, like the working-tree lock's "someone else got there first, skip quietly". */
const YIELD_EXIT_CODE = 2

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

/** "45m", "2h", "90" (minutes). Anything else is a usage error, not a guess. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours)?$/i.exec(text.trim())
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = (m[2] ?? 'm').toLowerCase()
  return unit.startsWith('h') ? Math.round(value * 60) : Math.round(value)
}

function whoAmI(): string {
  try {
    return execFileSync('whoami', { encoding: 'utf8' }).trim() || 'someone'
  } catch {
    return 'someone'
  }
}

function printStatus(stateDir: string, now: Date): void {
  const pause = readPause({ stateDir, now })
  const holders = liveHolders({ stateDir, isProcessAlive })

  if (!pause && holders.length === 0) {
    console.log('The scheduled /fixall loops are running normally (nothing is paused).')
    return
  }
  if (pause) {
    const left = Math.max(1, Math.round((new Date(pause.until).getTime() - now.getTime()) / 60_000))
    console.log(
      `PAUSED by ${pause.who}${pause.reason ? `: ${pause.reason}` : ''} — ${left} minute(s) left (until ${pause.until}).`,
    )
    console.log('  Resume early with: npm run fixall:resume')
  }
  for (const h of holders) {
    console.log(`WORKING: ${h.harness} (pid ${h.pid}) holds ${h.worktree} since ${h.startedAt}`)
  }
  if (holders.length > 0) {
    console.log('  Those clear themselves when the session exits — nothing to run.')
  }
}

function main(): void {
  const stateDir = defaultFixallStateDir()
  const now = new Date()
  const args = process.argv.slice(2).filter(a => a !== '--')
  const first = args[0]

  if (first === 'status') {
    printStatus(stateDir, now)
    return
  }

  if (first === 'yield') {
    const selfPid = Number(flagValue(args, '--self-pid') ?? process.ppid)
    const verdict = shouldYield({ stateDir, now, selfPid, isProcessAlive })
    if (verdict.yield) {
      console.log(verdict.reason)
      process.exit(YIELD_EXIT_CODE)
    }
    return
  }

  if (first === 'resume' || first === 'clear') {
    const pause = readPause({ stateDir, now })
    clearPause({ stateDir })
    console.log(pause ? 'Resumed: the scheduled /fixall loops will run again.' : 'Nothing was paused.')
    const holders = liveHolders({ stateDir, isProcessAlive })
    if (holders.length > 0) {
      console.log(
        `  Note: ${holders.length} live session(s) still pause the loops; they clear when those exit.`,
      )
    }
    return
  }

  // Everything else is a pause: [duration] [reason...]
  let minutes: number | undefined
  let reasonFrom = 0
  if (first !== undefined) {
    const parsed = parseDuration(first)
    if (parsed !== null) {
      minutes = parsed
      reasonFrom = 1
    }
  }
  const reason = args.slice(reasonFrom).join(' ').trim()

  const pause = writePause({ stateDir, minutes, who: whoAmI(), reason, now })
  const until = new Date(pause.until).toLocaleTimeString()
  console.log(
    `Paused the scheduled /fixall loops for ${pause.minutes} minute(s) — until ${until}${
      pause.reason ? ` (${pause.reason})` : ''
    }.`,
  )
  if (pause.capped) {
    console.log(`  Capped at the ${MAX_PAUSE_MINUTES}-minute maximum: a pause must always expire.`)
  }
  if (minutes === undefined) {
    console.log(`  No duration given, so the ${DEFAULT_PAUSE_MINUTES}-minute default was used.`)
  }
  console.log('  It expires on its own. Resume early with: npm run fixall:resume')
}

main()
