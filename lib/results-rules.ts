/**
 * The Pending results lane (ADEV-274 in astrid-core, ADEV-279 here; D74 in astrid-core's
 * docs/CONTRACTS.md, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 7). The first preset column with rules
 * of its own, modelled on the Waiting lane (lib/waiting-rules.ts) and decided the same way:
 * **astrid-core is canonical** (`resultsWrite`, `resultsSettle` on the rules door, vendored at
 * packages/astrid-rules/), and this is its TypeScript mirror: the answer whenever the core cannot
 * give one, and what the parity test (tests/lib/core-rules-results-parity.test.ts) replays against
 * the core's generated fixture.
 *
 * The column is a preset no board has until a person adds it (ADEV-286). A board without it never
 * reaches these rules: its experiments and verifications still link, refresh and report on the task,
 * and nothing moves by rule.
 *
 * - **P1** entering needs something to wait for: an open experiment, or a verification with
 *   `decideBy` ahead. Otherwise `RESULTS_NEEDS_CONDITION`.
 * - **P2** entering unassigns, and remembers the holder.
 * - **P3** every condition concluded `improving` → complete.
 * - **P4** any `regressing`; or, once the latest `decideBy` has come, any condition still open
 *   (silent) or concluded `inconclusive`; or no condition at all → hand back to the escalation
 *   target, with a Decision. Nothing rolls back.
 * - **P5** otherwise stay, including a stale source before its deadline.
 * - **P6** leaving by hand is always allowed.
 */
import { lazyValue } from '@/lib/lazy-value'
import { RESULTS_STATUS_ROLE } from '@/lib/board-presets'
import type { ResultConditionWire } from '@/lib/task-experiment'

export { RESULTS_STATUS_ROLE }
export const RESULTS_NEEDS_CONDITION = 'RESULTS_NEEDS_CONDITION'
export const RESULTS_NEEDS_CONDITION_MESSAGE = 'Pending results needs an experiment or a verification to wait on'

export type ResultCondition = ResultConditionWire

export interface ResultsTask {
  id: string
  statusRole?: string | null
  assigneeId?: string | null
  completed?: boolean | null
}

export interface ResultsChange {
  /** A role, `null` for Inbox; the key absent for "not a move". */
  statusRole?: string | null
  keepAssignee?: boolean
}

export type ResultsTransition = 'none' | 'enter' | 'stay'

export interface ResolvedResultsWrite {
  statusRole: string | null
  assignee: 'keep' | 'clear'
  transition: ResultsTransition
  /** With `assignee: "clear"`: who held the task, for the server to remember. */
  rememberAssigneeId?: string
}

export type ResultsWriteAnswer =
  | { ok: true; value: ResolvedResultsWrite }
  | { ok: false; code: typeof RESULTS_NEEDS_CONDITION; message: string }

export type ResultsAction = 'stay' | 'complete' | 'handBack'
export type HandBackReason = 'regressing' | 'silent' | 'inconclusive' | 'noCondition'

export interface ResultsSettlement {
  action: ResultsAction
  reason?: HandBackReason
  /** With `handBack`: Inbox, open, assigned to the escalation target. */
  statusRole?: null
  assigneeId?: string
  completed?: false
}

// ── The TypeScript mirror ────────────────────────────────────────────────────

function instant(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

export function isPendingResults(task: ResultsTask): boolean {
  return !task.completed && (task.statusRole ?? null) === RESULTS_STATUS_ROLE
}

/** P1: whether one condition is something to wait for at `now`. */
function isPending(condition: ResultCondition, now: Date): boolean {
  if (condition.state !== 'open') return false
  if (condition.kind === 'experiment') return true
  const by = instant(condition.decideBy)
  return by !== null && by > now.getTime()
}

export function hasResultCondition(conditions: readonly ResultCondition[], now: Date): boolean {
  return conditions.some(condition => isPending(condition, now))
}

export function resolveResultsWriteTs(
  task: ResultsTask,
  conditions: readonly ResultCondition[],
  change: ResultsChange,
  now: Date,
): ResultsWriteAnswer {
  const wasIn = isPendingResults(task)
  const setsRole = Object.hasOwn(change, 'statusRole')
  const asked = setsRole ? (change.statusRole ? change.statusRole : null) : (task.statusRole ?? null)
  const toLane = setsRole ? asked === RESULTS_STATUS_ROLE : wasIn
  if (!toLane) return { ok: true, value: { statusRole: asked, assignee: 'keep', transition: 'none' } }
  if (wasIn) return { ok: true, value: { statusRole: RESULTS_STATUS_ROLE, assignee: 'keep', transition: 'stay' } }
  if (!hasResultCondition(conditions, now)) {
    return { ok: false, code: RESULTS_NEEDS_CONDITION, message: RESULTS_NEEDS_CONDITION_MESSAGE }
  }
  const holder = task.assigneeId || undefined
  if (holder && !change.keepAssignee) {
    return { ok: true, value: { statusRole: RESULTS_STATUS_ROLE, assignee: 'clear', transition: 'enter', rememberAssigneeId: holder } }
  }
  return { ok: true, value: { statusRole: RESULTS_STATUS_ROLE, assignee: 'keep', transition: 'enter' } }
}

const passed = (condition: ResultCondition) => condition.state === 'concluded' && condition.verdict === 'improving'

/** When the answer is due from one condition: `undefined` = never (an open one with no day). */
function due(condition: ResultCondition): number | null | undefined {
  const by = instant(condition.decideBy)
  if (by !== null) return by
  return condition.state === 'concluded' ? null : undefined
}

export function settleResultsTs(
  task: ResultsTask,
  conditions: readonly ResultCondition[],
  escalateTo: string,
  now: Date,
): ResultsSettlement {
  if (!isPendingResults(task)) return { action: 'stay' }
  const handed = (reason: HandBackReason): ResultsSettlement => ({
    action: 'handBack',
    reason,
    statusRole: null,
    assigneeId: escalateTo,
    completed: false,
  })
  if (conditions.length === 0) return handed('noCondition')
  if (conditions.some(condition => condition.verdict === 'regressing')) return handed('regressing')
  if (conditions.every(passed)) return { action: 'complete' }
  // Not passed, not regressing: wait until the latest answer is due, if every one has a day.
  let latest: number | null = null
  for (const condition of conditions) {
    const d = due(condition)
    if (d === undefined) return { action: 'stay' }
    if (d !== null && (latest === null || d > latest)) latest = d
  }
  if (latest !== null && latest > now.getTime()) return { action: 'stay' }
  return handed(conditions.some(condition => condition.state === 'open') ? 'silent' : 'inconclusive')
}

// ── Where astrid-core plugs in ───────────────────────────────────────────────

export interface ResultsCore {
  write(
    question: { task: ResultsTask; conditions: readonly ResultCondition[]; change: ResultsChange; now: Date },
    typescriptAnswer: () => ResultsWriteAnswer,
  ): ResultsWriteAnswer | undefined
  settle(
    question: { task: ResultsTask; conditions: readonly ResultCondition[]; escalateTo: string; now: Date },
    typescriptAnswer: () => ResultsSettlement,
  ): ResultsSettlement | undefined
}

// On globalThis, as with the other core hooks: Next compiles this module into several layers.
const CORE_KEY = Symbol.for('astrid.results.core')
type CoreHost = { [CORE_KEY]?: ResultsCore | null }

export function setResultsCore(core: ResultsCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

const installed = (): ResultsCore | null | undefined => (globalThis as CoreHost)[CORE_KEY]

function throughCore<T>(ask: (core: ResultsCore, typescript: () => T) => T | undefined, compute: () => T): T {
  const core = installed()
  if (!core) return compute()
  const typescript = lazyValue(compute)
  try {
    return ask(core, typescript) ?? typescript()
  } catch {
    return typescript()
  }
}

export function resultsWrite(
  task: ResultsTask,
  conditions: readonly ResultCondition[],
  change: ResultsChange,
  now: Date = new Date(),
): ResultsWriteAnswer {
  return throughCore(
    (core, typescript) => core.write({ task, conditions, change, now }, typescript),
    () => resolveResultsWriteTs(task, conditions, change, now),
  )
}

export function resultsSettle(
  task: ResultsTask,
  conditions: readonly ResultCondition[],
  escalateTo: string,
  now: Date = new Date(),
): ResultsSettlement {
  return throughCore(
    (core, typescript) => core.settle({ task, conditions, escalateTo, now }, typescript),
    () => settleResultsTs(task, conditions, escalateTo, now),
  )
}
