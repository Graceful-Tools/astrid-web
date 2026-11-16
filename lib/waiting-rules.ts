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
 * - R8: a handoff (AWTD-1686) files the other half Ready on another list and parks the source in
 *   Waiting on it, unassigned, remembering its holder; when the source wakes by rule with nobody
 *   assigned, the answer is `assignee: "return"` with that holder (`returnAssigneeId`).
 *
 * Imports only lib/lazy-value.ts and lib/board-presets.ts, so client components may use it.
 */

import { lazyValue } from '@/lib/lazy-value'
import { availableBoardPresets, type BoardPreset } from '@/lib/board-presets'

export { BOARD_PRESETS, TESTING_STATUS_ROLE, type BoardPreset } from '@/lib/board-presets'

export const WAITING_ROLE = 'waiting'
export const READY_ROLE = 'ready'

/** The refusal code, the same spelling whichever side refused. */
export const WAITING_NEEDS_CONDITION = 'WAITING_NEEDS_CONDITION'
/** The core's own refusal message; the server answers a user-readable one (see services/task-waiting.ts). */
export const WAITING_NEEDS_CONDITION_MESSAGE = 'Waiting needs a date or a task to wait on'
/** R8: the refusal code for a handoff whose source is finished. */
export const HANDOFF_SOURCE_DONE = 'HANDOFF_SOURCE_DONE'
/** The core's own refusal message for it. */
export const HANDOFF_SOURCE_DONE_MESSAGE = 'A finished task cannot be handed off'

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

/** `return`: write the assignee back to the holder a handoff remembered (R8), `returnAssigneeId`. */
export type AssigneeWrite = 'keep' | 'clear' | 'return'
export type WaitingTransition = 'none' | 'enter' | 'stay' | 'wake' | 'inbox'

export interface ResolvedWaitingWrite {
  statusRole: string | null
  assignee: AssigneeWrite
  transition: WaitingTransition
  /** With `assignee: 'return'` only (R8). */
  returnAssigneeId?: string
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
  /** With `assignee: 'return'` only (R8). */
  returnAssigneeId?: string
}

/** R8: what one handoff writes (astrid-core `waitingHandoff`). */
export interface HandoffPlan {
  half: { statusRole: string; originTaskId: string }
  /** The source's write: `enter` (unassigned when it was assigned), or `stay` if already waiting. */
  source: ResolvedWaitingWrite
  /** Who held the source, to be remembered; null when nobody did. */
  returnAssigneeId: string | null
}

export type HandoffAnswer =
  | { ok: true; value: HandoffPlan }
  | { ok: false; code: typeof HANDOFF_SOURCE_DONE; message: string }

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

/** R8: who a task leaving Waiting by rule goes back to — nobody if somebody is assigned now. */
function holderToReturn(task: WaitingTask, returnTo: string | null | undefined): string | undefined {
  if (task.assigneeId) return undefined
  return returnTo ? returnTo : undefined
}

/** R1/R2/R8: the TypeScript answer to `waitingWrite`; `returnTo` is the holder a handoff remembered. */
export function resolveWaitingWriteTs(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  change: WaitingChange,
  now: Date,
  returnTo?: string | null,
): WaitingWriteAnswer {
  const answer = resolveWaitingWriteNoReturn(task, blockers, change, now)
  if (!answer.ok || (answer.value.transition !== 'wake' && answer.value.transition !== 'inbox')) return answer
  const holder = holderToReturn(task, returnTo)
  return holder ? { ok: true, value: { ...answer.value, assignee: 'return', returnAssigneeId: holder } } : answer
}

function resolveWaitingWriteNoReturn(
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

/** R3 + R5 + R8: the TypeScript answer to `waitingSettle`; `returnTo` is the remembered holder. */
export function settleWaitingTs(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  now: Date,
  returnTo?: string | null,
): Settlement {
  const settlement = settleNoReturn(task, blockers, now)
  if (settlement.action !== 'wakeToReady' && settlement.action !== 'resolveToInbox') return settlement
  const holder = holderToReturn(task, returnTo)
  return holder ? { ...settlement, assignee: 'return', returnAssigneeId: holder } : settlement
}

function settleNoReturn(task: WaitingTask, blockers: readonly WaitingBlocker[], now: Date): Settlement {
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

/**
 * R8: the TypeScript answer to `waitingHandoff`. `heldReturn` is the holder an earlier handoff
 * remembered for the source, if any. The half has no id yet; an open blocker is a condition (R1).
 */
export function handoffTs(
  source: WaitingTask,
  blockers: readonly WaitingBlocker[],
  heldReturn: string | null | undefined,
  now: Date,
): HandoffAnswer {
  if (source.completed) return { ok: false, code: HANDOFF_SOURCE_DONE, message: HANDOFF_SOURCE_DONE_MESSAGE }
  const write = resolveWaitingWriteNoReturn(
    source,
    blockers,
    { statusRole: WAITING_ROLE, addBlockers: [{ id: '\u0000pending-half', completed: false }] },
    now,
  )
  const sourceWrite: ResolvedWaitingWrite = write.ok
    ? write.value
    : { statusRole: WAITING_ROLE, assignee: 'clear', transition: 'enter' }
  return {
    ok: true,
    value: {
      half: { statusRole: READY_ROLE, originTaskId: source.id },
      source: sourceWrite,
      returnAssigneeId: source.assigneeId || heldReturn || null,
    },
  }
}

/** R7: the TypeScript answer to `boardPresets` (lib/board-presets.ts). */
export function boardPresetsTs(customStates: unknown): BoardPreset[] {
  return availableBoardPresets(customStates)
}

// ── Where astrid-core plugs in ───────────────────────────────────────────────

/**
 * The installed core. Each method returns its answer, or `undefined` to leave the TypeScript's
 * standing (shadow mode, or the core could not answer). The TypeScript answer is a getter,
 * computed only when asked for: for a fallback or a sampled comparison (AWTD-1591).
 */
export interface WaitingCore {
  write(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; change: WaitingChange; now: Date; returnAssigneeId?: string | null },
    typescriptAnswer: () => WaitingWriteAnswer,
  ): WaitingWriteAnswer | undefined
  settle(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; now: Date; returnAssigneeId?: string | null },
    typescriptAnswer: () => Settlement,
  ): Settlement | undefined
  /** R8. Optional: a core installed before the handoff rule leaves the TypeScript standing. */
  handoff?(
    question: { source: WaitingTask; blockers: readonly WaitingBlocker[]; returnAssigneeId?: string | null; now: Date },
    typescriptAnswer: () => HandoffAnswer,
  ): HandoffAnswer | undefined
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

/**
 * R1/R2 (and R8) — `waitingWrite`. Core first, TypeScript fallback. `returnAssigneeId` is the holder
 * a handoff remembered for the task (`Task.handoffReturnAssigneeId`), when there is one.
 */
export function waitingWrite(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  change: WaitingChange,
  now: Date = new Date(),
  returnAssigneeId?: string | null,
): WaitingWriteAnswer {
  return throughCore(
    (core, typescript) => core.write({ task, blockers, change, now, returnAssigneeId }, typescript),
    () => resolveWaitingWriteTs(task, blockers, change, now, returnAssigneeId),
  )
}

/** R3 + R5 (and R8) — `waitingSettle`. Core first, TypeScript fallback. */
export function waitingSettle(
  task: WaitingTask,
  blockers: readonly WaitingBlocker[],
  now: Date = new Date(),
  returnAssigneeId?: string | null,
): Settlement {
  return throughCore(
    (core, typescript) => core.settle({ task, blockers, now, returnAssigneeId }, typescript),
    () => settleWaitingTs(task, blockers, now, returnAssigneeId),
  )
}

/** R8 — `waitingHandoff`. Core first, TypeScript fallback. */
export function waitingHandoff(
  source: WaitingTask,
  blockers: readonly WaitingBlocker[],
  returnAssigneeId: string | null | undefined,
  now: Date = new Date(),
): HandoffAnswer {
  return throughCore(
    (core, typescript) => core.handoff?.({ source, blockers, returnAssigneeId, now }, typescript),
    () => handoffTs(source, blockers, returnAssigneeId, now),
  )
}

/** R7 — `boardPresets`. Core first, TypeScript fallback. */
export function boardPresets(customStates: unknown): BoardPreset[] {
  return throughCore(
    (core, typescript) => core.presets(customStates, typescript),
    () => boardPresetsTs(customStates),
  )
}
