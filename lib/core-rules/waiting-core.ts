/**
 * The Waiting lane decided by astrid-core (Jon, 2026-11-12): `waitingWrite`, `waitingSettle` and
 * `boardPresets` on the rules door, installed behind lib/waiting-rules.ts.
 *
 * The first core-FIRST rule: astrid-core is canonical, its fixture (contracts/fixtures/waiting.json
 * in astrid-core, vendored as packages/astrid-rules/fixtures/waiting.json) is generated there, and
 * the TypeScript in lib/waiting-rules.ts is the mirror. It is kept for the same two reasons as the
 * other cutovers (list-permissions-core.ts):
 *
 * - **Fail-safe.** Its answer is returned whenever the core cannot give one.
 * - **Comparison.** The browser decides whether to open the Waiting prompt with the same
 *   TypeScript, so a disagreement is a prompt the browser skips that the server then refuses (or
 *   the reverse). Logged once per distinct shape — which fields differed, the transition kinds —
 *   never a task id, title or assignee.
 *
 * Sampled per lib/core-rules/sampling.ts. The same `ASTRID_CORE_RULES` setting chooses the mode.
 */
import { createLogger } from '@/lib/logger'
import {
  setWaitingCore,
  WAITING_NEEDS_CONDITION,
  type BoardPreset,
  type Settlement,
  type WaitingBlocker,
  type WaitingChange,
  type WaitingTask,
  type WaitingWriteAnswer,
} from '@/lib/waiting-rules'
import { coreRulesModeFrom, type CoreRulesMode, type CoreRulesStatus, type CoreStats } from './list-permissions-core'
import { createSampler, sampleEveryFrom } from './sampling'
import { loadCoreRules } from './wasm'

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
}

const MAX_LOGGED = 50
const TRANSITIONS = new Set(['none', 'enter', 'stay', 'wake', 'inbox'])
const ACTIONS = new Set(['stay', 'wakeToReady', 'resolveToInbox', 'parkInWaiting'])
const ASSIGNEE = new Set(['keep', 'clear'])

const isString = (value: unknown): value is string => typeof value === 'string'
const isRole = (value: unknown) => value === null || isString(value)

function iso(value: string | Date | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** The task as the core's model reads it. */
function wireTask(task: WaitingTask) {
  return {
    id: task.id,
    statusRole: task.statusRole ?? null,
    dueDateTime: iso(task.dueDateTime) ?? null,
    isAllDay: Boolean(task.isAllDay),
    assigneeId: task.assigneeId ?? null,
    completed: Boolean(task.completed),
  }
}

/** The change as the core reads it: an absent key stays absent, `null` stays `null`. */
function wireChange(change: WaitingChange) {
  const wire: Record<string, unknown> = {}
  if (Object.hasOwn(change, 'statusRole')) wire.statusRole = change.statusRole ?? null
  if (Object.hasOwn(change, 'dueDateTime')) wire.dueDateTime = iso(change.dueDateTime) ?? null
  if (change.addBlockers?.length) wire.addBlockers = change.addBlockers.map(({ id, completed }) => ({ id, completed }))
  if (change.removeBlockerIds?.length) wire.removeBlockerIds = [...change.removeBlockerIds]
  if (change.keepAssignee) wire.keepAssignee = true
  return wire
}

const wireBlockers = (blockers: readonly WaitingBlocker[]) => blockers.map(({ id, completed }) => ({ id, completed: Boolean(completed) }))

/** A `waitingWrite` envelope as an answer, or null when it is not one. */
export function writeAnswerFrom(raw: string): WaitingWriteAnswer | null {
  const reply = JSON.parse(raw) as { ok: boolean; value?: Record<string, unknown>; error?: { code?: string; message?: string } }
  if (!reply.ok) {
    if (reply.error?.code !== WAITING_NEEDS_CONDITION) return null
    return { ok: false, code: WAITING_NEEDS_CONDITION, message: reply.error.message ?? '' }
  }
  const value = reply.value
  if (!value || !isRole(value.statusRole) || !ASSIGNEE.has(value.assignee as string) || !TRANSITIONS.has(value.transition as string)) {
    return null
  }
  return {
    ok: true,
    value: {
      statusRole: (value.statusRole as string | null) ?? null,
      assignee: value.assignee as 'keep' | 'clear',
      transition: value.transition as never,
    },
  }
}

function differingWrite(a: WaitingWriteAnswer, b: WaitingWriteAnswer): string[] {
  if (a.ok !== b.ok) return ['refused']
  if (!a.ok || !b.ok) return []
  return (['statusRole', 'assignee', 'transition'] as const).filter((field) => a.value[field] !== b.value[field])
}

function differingSettle(a: Settlement, b: Settlement): string[] {
  return (['action', 'statusRole', 'assignee'] as const).filter((field) => a[field] !== b[field])
}

function differingPresets(a: BoardPreset[], b: BoardPreset[]): string[] {
  if (a.length !== b.length) return ['count']
  return (['role', 'name', 'description'] as const).filter((field) => a.some((preset, i) => preset[field] !== b[i][field]))
}

/** The shape of a write, from a fixed vocabulary — never an id, a title or a person. */
function writeShape(task: WaitingTask, change: WaitingChange, blockers: readonly WaitingBlocker[]) {
  return {
    from: task.completed ? 'done' : task.statusRole === 'waiting' ? 'waiting' : task.statusRole ? 'status' : 'inbox',
    setsRole: Object.hasOwn(change, 'statusRole') ? (change.statusRole === 'waiting' ? 'waiting' : 'other') : 'absent',
    setsDate: Object.hasOwn(change, 'dueDateTime') ? (change.dueDateTime ? 'set' : 'cleared') : 'absent',
    blockers: blockers.length,
    added: change.addBlockers?.length ?? 0,
    removed: change.removeBlockerIds?.length ?? 0,
  }
}

/**
 * A {@link setWaitingCore} hook backed by `runJson`. In `decide` mode it returns the core's answers;
 * in `shadow` mode `undefined`, so the TypeScript decides. A core that THROWS is switched off for
 * the rest of the process, as for permissions.
 */
export function createWaitingCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide', sampleEvery = 1 }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'>; sampleEvery?: number } = {},
) {
  const stats: CoreStats = { agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 0 }
  const sampled = createSampler(sampleEvery)
  const logged = new Set<string>()
  let failureLogged = false
  let tripped = false

  function fail(rule: string, error: unknown): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ rule, revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  /** The raw reply, or `undefined` after recording a throw. */
  function call(rule: string, request: object): string | undefined {
    try {
      return runJson(JSON.stringify(request))
    } catch (error) {
      tripped = true
      return fail(rule, error)
    }
  }

  function okValue(rule: string, raw: string): unknown {
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: unknown; error?: { kind?: string } }
      if (!reply.ok || reply.value === undefined) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      return reply.value
    } catch (error) {
      return fail(rule, error)
    }
  }

  function compare<T>(rule: string, core: T, compared: boolean, differing: () => string[], shape: () => Record<string, unknown>): T | undefined {
    if (!compared) {
      stats.unsampled++
      return mode === 'decide' ? core : undefined
    }
    let fields: string[]
    try {
      fields = differing()
    } catch {
      stats.unsampled++
      return mode === 'decide' ? core : undefined
    }
    if (fields.length === 0) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const details = { rule, differing: fields, ...shape() }
        const signature = JSON.stringify(details)
        if (logged.size < MAX_LOGGED && !logged.has(signature)) {
          logged.add(signature)
          report.disagreement({ ...details, revision, mode, returned: mode === 'decide' ? 'core' : 'typescript', stats: { ...stats } })
        }
      } catch {
        // Reporting must never change an answer.
      }
    }
    return mode === 'decide' ? core : undefined
  }

  /** Whether to ask at all: shadow mode asks only on a sampled decision. */
  function begin(rule: string): { compared: boolean } | undefined {
    if (tripped) return fail(rule, 'core switched off after it threw')
    const compared = sampled()
    if (mode === 'shadow' && !compared) {
      stats.unsampled++
      return undefined
    }
    return { compared }
  }

  function write(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; change: WaitingChange; now: Date },
    typescriptAnswer: () => WaitingWriteAnswer,
  ): WaitingWriteAnswer | undefined {
    const started = begin('waitingWrite')
    if (!started) return undefined
    const { task, blockers, change, now } = question
    const raw = call('waitingWrite', {
      kind: 'waitingWrite',
      task: wireTask(task),
      blockers: wireBlockers(blockers),
      change: wireChange(change),
      now: now.toISOString(),
    })
    if (raw === undefined) return undefined
    let core: WaitingWriteAnswer | null
    try {
      core = writeAnswerFrom(raw)
    } catch (error) {
      return fail('waitingWrite', error)
    }
    if (!core) return fail('waitingWrite', 'core answered something that is not a waiting write')
    const answer = core
    return compare('waitingWrite', answer, started.compared, () => differingWrite(answer, typescriptAnswer()), () =>
      writeShape(task, change, blockers),
    )
  }

  function settle(
    question: { task: WaitingTask; blockers: readonly WaitingBlocker[]; now: Date },
    typescriptAnswer: () => Settlement,
  ): Settlement | undefined {
    const started = begin('waitingSettle')
    if (!started) return undefined
    const { task, blockers, now } = question
    const raw = call('waitingSettle', { kind: 'waitingSettle', task: wireTask(task), blockers: wireBlockers(blockers), now: now.toISOString() })
    if (raw === undefined) return undefined
    const value = okValue('waitingSettle', raw) as Record<string, unknown> | undefined
    if (value === undefined) return undefined
    if (!value || !ACTIONS.has(value.action as string) || !isRole(value.statusRole) || !ASSIGNEE.has(value.assignee as string)) {
      return fail('waitingSettle', 'core answered something that is not a settlement')
    }
    const core: Settlement = {
      action: value.action as Settlement['action'],
      statusRole: (value.statusRole as string | null) ?? null,
      assignee: value.assignee as Settlement['assignee'],
    }
    return compare('waitingSettle', core, started.compared, () => differingSettle(core, typescriptAnswer()), () => ({
      from: task.completed ? 'done' : task.statusRole === 'waiting' ? 'waiting' : task.statusRole === 'ready' ? 'ready' : 'other',
      blockers: blockers.length,
      dated: Boolean(task.dueDateTime),
    }))
  }

  function presets(customStates: unknown, typescriptAnswer: () => BoardPreset[]): BoardPreset[] | undefined {
    const started = begin('boardPresets')
    if (!started) return undefined
    // call() stringifies inside its guard, so a customStates value that cannot be sent is a failure.
    const raw = call('boardPresets', { kind: 'boardPresets', customStates: Array.isArray(customStates) ? customStates : null })
    if (raw === undefined) return undefined
    const value = okValue('boardPresets', raw)
    if (value === undefined) return undefined
    const valid =
      Array.isArray(value) &&
      value.every((preset) => preset && isString(preset.role) && isString(preset.name) && isString(preset.description))
    if (!valid) return fail('boardPresets', 'core answered something that is not presets')
    const core = (value as BoardPreset[]).map(({ role, name, description }) => ({ role, name, description }))
    return compare('boardPresets', core, started.compared, () => differingPresets(core, typescriptAnswer()), () => ({
      customCount: Array.isArray(customStates) ? customStates.length : null,
    }))
  }

  return { write, settle, presets, stats }
}

const STATUS_KEY = Symbol.for('astrid.waiting.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function waitingCoreStatus(): CoreRulesStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it behind lib/waiting-rules.ts. Called from
 * instrumentation.ts on the Node runtime. Returns whether the core is installed; never throws.
 */
export function installWaitingCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  const sampleEvery = sampleEveryFrom()
  host[STATUS_KEY] = { mode, sampleEvery, loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setWaitingCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; Waiting is decided by the TypeScript')
      return false
    }
    const hook = createWaitingCore(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'waiting: astrid-core and the TypeScript disagree'),
        failure: (details) => log.error(details, 'waiting: astrid-core could not answer; the TypeScript answer was used'),
      },
      { revision: core.revision, mode, sampleEvery },
    )
    setWaitingCore({ write: hook.write, settle: hook.settle, presets: hook.presets })
    host[STATUS_KEY] = { mode, sampleEvery, loaded: true, revision: core.revision, stats: hook.stats }
    log.info({ revision: core.revision, mode }, 'waiting: astrid-core installed')
    return true
  } catch (error) {
    setWaitingCore(null)
    try {
      log.error({ err: error, mode }, 'waiting: astrid-core install failed; the TypeScript decides')
    } catch {
      // Never fatal.
    }
    return false
  }
}
