/**
 * The Waiting lane's rules, as astrid-core decides them (Jon, 2026-11-12).
 *
 * **Canonical in astrid-core** (`crates/astrid-rules/src/waiting.rs`, the rules door's
 * `waitingWrite` / `waitingWake` / `waitingSettle` / `handBack` / `boardPresets`). On the Node
 * runtime instrumentation.ts installs lib/core-rules/waiting-core.ts behind this module, and the
 * server's answer is the core's. What is written below is the mirror the server falls back to when
 * the core cannot answer, and that the browser uses to decide whether to open the Waiting prompt
 * before it sends a write. tests/lib/core-rules-waiting-parity.test.ts replays the core-owned
 * fixture (packages/astrid-rules/fixtures/waiting.json) against it, so it cannot drift silently.
 *
 * The rules (docs: the spec of record is the astrid-core module doc):
 *
 * - R1: a task may be in Waiting only while it has a **wait condition** — a due date strictly in the
 *   future, or at least one blocking task that is not complete.
 * - R2: a move INTO Waiting needs a condition (in the same write or already on the task) or is
 *   refused with `WAITING_NEEDS_CONDITION`; entering clears the assignee unless the mover keeps it.
 *   An edit to a task already in Waiting that removes its last condition wakes it instead.
 * - R3: a Waiting task whose condition is gone wakes to Ready; one that never had a condition
 *   (legacy data) goes to Inbox, keeping its assignee.
 * - R4: waiting on a PERSON is Inbox, assigned to them.
 * - R5: a Ready task with a future date is parked in Waiting, unassigned.
 * - R7: optional preset columns a board can add (the first: `testing`).
 *
 * Imports nothing but lib/lazy-value.ts, so client components may use it.
 */

import { lazyValue } from '@/lib/lazy-value'

export const WAITING_ROLE = 'waiting'
export const READY_ROLE = 'ready'
/** R7's fixed role. Not minted (`custom-…`) so the deploy check finds it on any board. */
export const TESTING_STATUS_ROLE = 'testing'

/** The refusal code, the same spelling whichever side refused. */
export const WAITING_NEEDS_CONDITION = 'WAITING_NEEDS_CONDITION'
/** The core's own refusal message; the server answers a user-readable one (see services/task-waiting.ts). */
export const WAITING_NEEDS_CONDITION_MESSAGE = 'Waiting needs a date or a task to wait on'

export interface WaitingBlocker {
  id: string
  completed: boolean
}

/** The task as the Waiting rules read it, before the write. Dates are ISO strings or Dates. */
export interface WaitingTask {
  id: string
  statusRole?: string | null
  dueDateTime?: string | Date | null
  isAllDay?: boolean | null
  assigneeId?: string | null
  completed?: boolean | null
}

/**
 * What a write asks for. A key that is absent means "unchanged"; `null` means "cleared".
 * (The core's `Option<Option<_>>`.)
 */
export interface WaitingChange {
  statusRole?: string | null
  dueDateTime?: string | Date | null
  addBlockers?: WaitingBlocker[]
  removeBlockerIds?: string[]
  keepAssignee?: boolean
}

export type AssigneeWrite = 'keep' | 'clear'
export type WaitingTransition = 'none' | 'enter' | 'stay' | 'wake' | 'inbox'

export interface ResolvedWaitingWrite {
  statusRole: string | null
  assignee: AssigneeWrite
  transition: WaitingTransition
}

export type WaitingWriteAnswer =
  | { ok: true; value: ResolvedWaitingWrite }
  | { ok: false; code: typeof WAITING_NEEDS_CONDITION; message: string }

export type WakeAction = 'stay' | 'wakeToReady' | 'resolveToInbox'
export type SettleAction = WakeAction | 'parkInWaiting'

export interface Settlement {
  action: SettleAction
  statusRole: string | null
  assignee: AssigneeWrite
}

export interface BoardPreset {
  role: string
  name: string
  description: string
}

/** R7, in the core's order. */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  { role: TESTING_STATUS_ROLE, name: 'Testing', description: 'Deploying, in canary, or in an experiment.' },
]

// ── The TypeScript mirror ────────────────────────────────────────────────────

/** An instant, or null for none / unreadable (the core reads an unreadable model date as none). */
function instant(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** `isDueToStart`: no date, or its date has come. */
export function isDueToStartAt(due: number | null, now: Date): boolean {
  return due === null || due <= now.getTime()
}

/** R1. */
export function hasWaitCondition(due: number | null, blockers: readonly WaitingBlocker[], now: Date): boolean {
  return !isDueToStartAt(due, now) || blockers.some(blocker => !blocker.completed)
}

function roleOf(task: WaitingTask): string | null {
  return task.statusRole ?? null
}

/** In the Waiting lane: the role, and not finished. */
export function isWaitingTask(task: WaitingTask): boolean {
  return !task.completed && roleOf(task) === WAITING_ROLE
}

function blockersAfter(blockers: readonly WaitingBlocker[], change: WaitingChange): WaitingBlocker[] {
  const removed = new Set(change.removeBlockerIds ?? [])
  const added = change.addBlockers ?? []
  const addedIds = new Set(added.map(blocker => blocker.id))
  return [
    ...blockers.filter(held => !removed.has(held.id) && !addedIds.has(held.id)),
    ...added,
  ]
}

/** R1/R2: the TypeScript answer to `waitingWrite`. */
export function resolveWaitingWriteTs(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  change: WaitingChange,
  now: Date,
): WaitingWriteAnswer {
  const wasWaiting = isWaitingTask(task)
  const setsRole = Object.hasOwn(change, 'statusRole')
  const asked = setsRole ? (change.statusRole ? change.statusRole : null) : roleOf(task)
  const toWaiting = setsRole ? asked === WAITING_ROLE : wasWaiting
  if (!toWaiting) {
    return { ok: true, value: { statusRole: asked, assignee: 'keep', transition: 'none' } }
  }

  const dueAfter = Object.hasOwn(change, 'dueDateTime') ? instant(change.dueDateTime) : instant(task.dueDateTime)
  const after = blockersAfter(blockers, change)
  const holdsAfter = hasWaitCondition(dueAfter, after, now)

  if (!wasWaiting) {
    if (!holdsAfter) {
      return { ok: false, code: WAITING_NEEDS_CONDITION, message: WAITING_NEEDS_CONDITION_MESSAGE }
    }
    const clear = !change.keepAssignee && Boolean(task.assigneeId)
    return { ok: true, value: { statusRole: WAITING_ROLE, assignee: clear ? 'clear' : 'keep', transition: 'enter' } }
  }

  if (holdsAfter) {
    return { ok: true, value: { statusRole: WAITING_ROLE, assignee: 'keep', transition: 'stay' } }
  }
  const heldBefore = hasWaitCondition(instant(task.dueDateTime), blockers, now)
  const wakes = heldBefore || dueAfter !== null || after.length > 0
  return {
    ok: true,
    value: wakes
      ? { statusRole: READY_ROLE, assignee: 'keep', transition: 'wake' }
      : { statusRole: null, assignee: 'keep', transition: 'inbox' },
  }
}

/** R3: the TypeScript answer to `waitingWake`. */
export function wakeWaitingTs(task: WaitingTask, blockers: readonly WaitingBlocker[], now: Date): WakeAction {
  const due = instant(task.dueDateTime)
  if (!isWaitingTask(task) || hasWaitCondition(due, blockers, now)) return 'stay'
  return due !== null || blockers.length > 0 ? 'wakeToReady' : 'resolveToInbox'
}

/** R3 + R5: the TypeScript answer to `waitingSettle`. */
export function settleWaitingTs(task: WaitingTask, blockers: readonly WaitingBlocker[], now: Date): Settlement {
  const stay: Settlement = { action: 'stay', statusRole: roleOf(task), assignee: 'keep' }
  if (task.completed) return stay
  if (isWaitingTask(task)) {
    switch (wakeWaitingTs(task, blockers, now)) {
      case 'wakeToReady':
        return { action: 'wakeToReady', statusRole: READY_ROLE, assignee: 'keep' }
      case 'resolveToInbox':
        return { action: 'resolveToInbox', statusRole: null, assignee: 'keep' }
      default:
        return stay
    }
  }
  if (roleOf(task) === READY_ROLE && !isDueToStartAt(instant(task.dueDateTime), now)) {
    return { action: 'parkInWaiting', statusRole: WAITING_ROLE, assignee: task.assigneeId ? 'clear' : 'keep' }
  }
  return stay
}

/** R4: the TypeScript answer to `handBack`. */
export function handBackTs(assigneeId: string): { statusRole: null; assigneeId: string; completed: false } {
  return { statusRole: null, assigneeId, completed: false }
}

/** R7: the presets this board can still add — not by role, nor by (case-insensitive) name. */
export function boardPresetsTs(customStates: unknown): BoardPreset[] {
  const states = Array.isArray(customStates) ? customStates : []
  const held = states
    .filter((state): state is Record<string, unknown> => Boolean(state) && typeof state === 'object')
    .map(state => ({
      role: typeof state.role === 'string' ? state.role : '',
      name: typeof state.name === 'string' ? state.name.toLowerCase() : '',
    }))
  return BOARD_PRESETS.filter(
    preset => !held.some(state => state.role === preset.role || state.name === preset.name.toLowerCase()),
  ).map(preset => ({ ...preset }))
}

// ── Where astrid-core plugs in ───────────────────────────────────────────────

/**
 * The installed core. Each method returns its answer, or `undefined` to leave the TypeScript's
 * standing (shadow mode, or the core could not answer). The TypeScript answer is a getter,
 * computed only when asked for: for a fallback or a sampled comparison (AWTD-1591).
 */
export interface WaitingCore {
  write(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; change: WaitingChange; now: Date },
    typescriptAnswer: () => WaitingWriteAnswer,
  ): WaitingWriteAnswer | undefined
  settle(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; now: Date },
    typescriptAnswer: () => Settlement,
  ): Settlement | undefined
  presets(customStates: unknown, typescriptAnswer: () => BoardPreset[]): BoardPreset[] | undefined
}

// On globalThis, as with the other core hooks: Next compiles this module into several layers.
const CORE_KEY = Symbol.for('astrid.waiting.core')
type CoreHost = { [CORE_KEY]?: WaitingCore | null }

/** Install (or, with `null`, remove) astrid-core's Waiting rules behind the TypeScript ones. */
export function setWaitingCore(core: WaitingCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

const installed = (): WaitingCore | null | undefined => (globalThis as CoreHost)[CORE_KEY]

function throughCore<T>(ask: (core: WaitingCore, typescript: () => T) => T | undefined, compute: () => T): T {
  const core = installed()
  if (!core) return compute()
  const typescript = lazyValue(compute)
  try {
    return ask(core, typescript) ?? typescript()
  } catch {
    return typescript()
  }
}

/** R1/R2 — `waitingWrite`. Core first, TypeScript fallback. */
export function waitingWrite(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  change: WaitingChange,
  now: Date = new Date(),
): WaitingWriteAnswer {
  return throughCore(
    (core, typescript) => core.write({ task, blockers, change, now }, typescript),
    () => resolveWaitingWriteTs(task, blockers, change, now),
  )
}

/** R3 + R5 — `waitingSettle`. Core first, TypeScript fallback. */
export function waitingSettle(task: WaitingTask, blockers: readonly WaitingBlocker[], now: Date = new Date()): Settlement {
  return throughCore(
    (core, typescript) => core.settle({ task, blockers, now }, typescript),
    () => settleWaitingTs(task, blockers, now),
  )
}

/** R7 — `boardPresets`. Core first, TypeScript fallback. */
export function boardPresets(customStates: unknown): BoardPreset[] {
  return throughCore(
    (core, typescript) => core.presets(customStates, typescript),
    () => boardPresetsTs(customStates),
  )
}
