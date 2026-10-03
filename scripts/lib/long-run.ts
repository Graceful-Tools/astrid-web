/**
 * Tasks that need longer than one scheduled run (AWTD-1041). Decided here,
 * where it can be tested; `scripts/agent-queue-status.ts` only prints the plan
 * and `scripts/fixall-loop.sh` only applies it.
 *
 * THE FLAG. A line in the task description, typed as easily from a phone as
 * from a desk:
 *
 *   LONG-RUN            → the maximum, 8 hours
 *   LONG-RUN: 3h        → 3 hours (also `90m`, `2.5 hours`, `120 minutes`)
 *
 * It must be its own line, so a description that merely talks about long runs
 * is not one. An amount that cannot be read means the maximum — the person who
 * wrote the line wanted a long run, and a 75-minute watchdog is exactly what
 * they were trying to avoid.
 *
 * WHY A WINDOW. A run holds the working-tree lock, and launchd starts no second
 * copy of the loop while the first is alive — so an 8-hour run is 16 ticks in
 * which nothing else on the board moves. A long task therefore only STARTS
 * inside the long-run window (overnight by default). Outside it the task is
 * deferred for that tick and the rest of the queue is worked as usual; inside
 * it the long task goes first, since the window is the only time it can run.
 */

import type { QueueSnapshotTask } from './agent-queue-verdict'

/** The longest a single scheduled run may be given. */
export const LONG_RUN_MAX_MINUTES = 480

/** Overnight, local time: start inclusive, end exclusive. */
export const DEFAULT_LONG_RUN_WINDOW = '22-6'

const MARKER = /^[ \t]*LONG-RUN[ \t]*(?::[ \t]*(.*?))?[ \t]*$/im
const AMOUNT = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)$/i

/** Minutes the task asks for, or null when it carries no LONG-RUN line. */
export function parseLongRun(description: string | null | undefined): number | null {
  const match = description ? MARKER.exec(description) : null
  if (!match) return null
  const amount = match[1] ? AMOUNT.exec(match[1].trim()) : null
  if (!amount) return LONG_RUN_MAX_MINUTES
  const value = Number(amount[1]) * (amount[2].toLowerCase().startsWith('h') ? 60 : 1)
  return Math.min(Math.round(value), LONG_RUN_MAX_MINUTES)
}

export interface LongRunWindow {
  /** Hour 0-23 the window opens, inclusive. */
  start: number
  /** Hour 1-24 it closes, exclusive. Less than `start` means it wraps midnight. */
  end: number
}

/** `22-6`, `1-5`, or `always`. Null for anything else — the caller says so. */
export function parseLongRunWindow(spec: string): LongRunWindow | null {
  const trimmed = spec.trim().toLowerCase()
  if (trimmed === 'always') return { start: 0, end: 24 }
  const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(trimmed)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (start > 23 || end > 24 || start === end) return null
  return { start, end }
}

export function inLongRunWindow(hour: number, window: LongRunWindow): boolean {
  return window.start < window.end
    ? hour >= window.start && hour < window.end
    : hour >= window.start || hour < window.end
}

export interface RunPlan<T extends QueueSnapshotTask> {
  /** The queue this tick may work — deferred tasks removed, a long task first in its window. */
  queue: T[]
  /** Long tasks held back because the window is shut. */
  deferred: T[]
  /** The task the watchdog was sized for; the run takes it first. */
  nextTask: T | null
  /** Watchdog for this run. */
  maxMinutes: number
  /** Whether this run was sized for a long task. */
  long: boolean
  /** One human-readable line for the loop's log, or null when nothing was flagged. */
  note: string | null
}

function hh(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`
}

export function planRun<T extends QueueSnapshotTask & { description?: string | null }>({
  queue,
  hour,
  defaultMinutes,
  window,
  maxTasks,
}: {
  queue: T[]
  /** Local hour, 0-23. */
  hour: number
  defaultMinutes: number
  window: LongRunWindow
  /** How many Ready tasks the run may take (ASTRID_FIXALL_MAX_TASKS). */
  maxTasks: number
}): RunPlan<T> {
  // A flag no longer than the ordinary watchdog needs no special handling.
  const minutesFor = (task: T) => {
    const minutes = parseLongRun(task.description)
    return minutes !== null && minutes > defaultMinutes ? minutes : null
  }
  const long = queue.filter(task => minutesFor(task) !== null)
  const open = inLongRunWindow(hour, window)
  const label = (task: T) => task.identifier ?? task.id

  const deferred = open ? [] : long
  const workable = open
    ? [...long, ...queue.filter(task => minutesFor(task) === null)]
    : queue.filter(task => minutesFor(task) === null)

  const taken = workable.slice(0, Math.max(1, maxTasks))
  const longest = Math.max(0, ...taken.map(task => minutesFor(task) ?? 0))
  const maxMinutes = Math.max(defaultMinutes, longest)

  let note: string | null = null
  if (deferred.length > 0) {
    note = `${deferred.map(label).join(', ')} flagged LONG-RUN — deferred to the ${hh(window.start)}–${hh(window.end)} window`
  } else if (longest > 0) {
    note = `${label(taken[0])} flagged LONG-RUN — watchdog ${maxMinutes}m`
  }

  return {
    queue: workable,
    deferred,
    nextTask: workable[0] ?? null,
    maxMinutes,
    long: longest > 0,
    note,
  }
}
