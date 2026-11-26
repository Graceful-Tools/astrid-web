/**
 * The Pending results lane decided by astrid-core (ADEV-274, ADEV-279): `resultsWrite` and
 * `resultsSettle` on the rules door, installed behind lib/results-rules.ts. Core-FIRST like the
 * Waiting lane (lib/core-rules/waiting-core.ts), which this follows closely: the TypeScript in
 * lib/results-rules.ts is the mirror and the fail-safe, an answer the core cannot give (a build
 * vendored before ADEV-274 answers "unknown kind") falls back to it and is logged as a failure,
 * and a disagreement is logged once per distinct shape, never with an id, title or person.
 *
 * Sampled per lib/core-rules/sampling.ts. The same `ASTRID_CORE_RULES` setting chooses the mode.
 */
import { createLogger } from '@/lib/logger'
import {
  RESULTS_NEEDS_CONDITION,
  setResultsCore,
  type HandBackReason,
  type ResolvedResultsWrite,
  type ResultCondition,
  type ResultsAction,
  type ResultsChange,
  type ResultsSettlement,
  type ResultsTask,
  type ResultsWriteAnswer,
} from '@/lib/results-rules'
import { coreRulesModeFrom, type CoreRulesMode } from './list-permissions-core'
import { createSampler, sampleEveryFrom } from './sampling'
import { loadCoreRules } from './wasm'

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
}

const MAX_LOGGED = 50
const ACTIONS = new Set<string>(['stay', 'complete', 'handBack'])
const REASONS = new Set<string>(['regressing', 'silent', 'inconclusive', 'noCondition'])
const TRANSITIONS = new Set<string>(['none', 'enter', 'stay'])

const isString = (value: unknown): value is string => typeof value === 'string'

function wireTask(task: ResultsTask) {
  return {
    id: task.id,
    statusRole: task.statusRole ?? null,
    assigneeId: task.assigneeId ?? null,
    completed: Boolean(task.completed),
  }
}

function wireChange(change: ResultsChange) {
  const wire: Record<string, unknown> = {}
  if (Object.hasOwn(change, 'statusRole')) wire.statusRole = change.statusRole ?? null
  if (change.keepAssignee) wire.keepAssignee = true
  return wire
}

const wireConditions = (conditions: readonly ResultCondition[]) =>
  conditions.map(({ kind, state, verdict, decideBy, fetchedAt }) => ({
    kind,
    state,
    verdict: verdict ?? null,
    decideBy: decideBy ?? null,
    fetchedAt: fetchedAt ?? null,
  }))

/** A `resultsWrite` envelope as an answer, or null when it is not one. */
export function resultsWriteAnswerFrom(raw: string): ResultsWriteAnswer | null {
  const reply = JSON.parse(raw) as { ok: boolean; value?: Record<string, unknown>; error?: { code?: string; message?: string } }
  if (!reply.ok) {
    if (reply.error?.code !== RESULTS_NEEDS_CONDITION) return null
    return { ok: false, code: RESULTS_NEEDS_CONDITION, message: reply.error.message ?? '' }
  }
  const value = reply.value
  if (!value || !(value.statusRole === null || isString(value.statusRole))) return null
  if (value.assignee !== 'keep' && value.assignee !== 'clear') return null
  if (!TRANSITIONS.has(value.transition as string)) return null
  const resolved: ResolvedResultsWrite = {
    statusRole: (value.statusRole as string | null) ?? null,
    assignee: value.assignee,
    transition: value.transition as ResolvedResultsWrite['transition'],
  }
  if (value.assignee === 'clear') {
    if (!isString(value.rememberAssigneeId)) return null
    resolved.rememberAssigneeId = value.rememberAssigneeId
  }
  return { ok: true, value: resolved }
}

/** A `resultsSettle` value as a settlement, or null when it is not one. */
export function settlementFrom(value: Record<string, unknown> | undefined): ResultsSettlement | null {
  if (!value || !ACTIONS.has(value.action as string)) return null
  const settlement: ResultsSettlement = { action: value.action as ResultsAction }
  if (value.action === 'handBack') {
    if (!REASONS.has(value.reason as string) || !isString(value.assigneeId) || value.statusRole !== null || value.completed !== false) return null
    settlement.reason = value.reason as HandBackReason
    settlement.statusRole = null
    settlement.assigneeId = value.assigneeId
    settlement.completed = false
  }
  return settlement
}

function differingWrite(a: ResultsWriteAnswer, b: ResultsWriteAnswer): string[] {
  if (a.ok !== b.ok) return ['refused']
  if (!a.ok || !b.ok) return []
  return (['statusRole', 'assignee', 'transition', 'rememberAssigneeId'] as const).filter(field => a.value[field] !== b.value[field])
}

function differingSettle(a: ResultsSettlement, b: ResultsSettlement): string[] {
  return (['action', 'reason', 'statusRole', 'assigneeId'] as const).filter(field => a[field] !== b[field])
}

/**
 * A hook backed by `runJson`. In `decide` mode it returns the core's answers; in `shadow` mode
 * `undefined`, so the TypeScript decides. A core that THROWS is switched off for the process.
 */
export function createResultsCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide', sampleEvery = 1 }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'>; sampleEvery?: number } = {},
) {
  const stats = { agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 0 }
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

  function ask<T>(
    rule: string,
    request: object,
    read: (raw: string) => T | null,
    typescript: () => T,
    differing: (core: T, ts: T) => string[],
    shape: Record<string, unknown>,
  ): T | undefined {
    if (tripped) return fail(rule, 'core switched off after it threw')
    const compared = sampled()
    if (mode === 'shadow' && !compared) {
      stats.unsampled++
      return undefined
    }
    let raw: string
    try {
      raw = runJson(JSON.stringify({ kind: rule, ...request }))
    } catch (error) {
      tripped = true
      return fail(rule, error)
    }
    let core: T | null
    try {
      core = read(raw)
    } catch (error) {
      return fail(rule, error)
    }
    if (!core) return fail(rule, 'core answered something that is not a results answer')
    if (!compared) {
      stats.unsampled++
      return mode === 'decide' ? core : undefined
    }
    let fields: string[]
    try {
      fields = differing(core, typescript())
    } catch {
      stats.unsampled++
      return mode === 'decide' ? core : undefined
    }
    if (fields.length === 0) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const details = { rule, differing: fields, ...shape }
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

  function write(
    question: { task: ResultsTask; conditions: readonly ResultCondition[]; change: ResultsChange; now: Date },
    typescriptAnswer: () => ResultsWriteAnswer,
  ): ResultsWriteAnswer | undefined {
    const { task, conditions, change, now } = question
    return ask(
      'resultsWrite',
      { task: wireTask(task), conditions: wireConditions(conditions), change: wireChange(change), now: now.toISOString() },
      resultsWriteAnswerFrom,
      typescriptAnswer,
      differingWrite,
      {
        from: task.completed ? 'done' : task.statusRole === 'results' ? 'results' : task.statusRole ? 'status' : 'inbox',
        setsRole: Object.hasOwn(change, 'statusRole') ? (change.statusRole === 'results' ? 'results' : 'other') : 'absent',
        conditions: conditions.length,
      },
    )
  }

  function settle(
    question: { task: ResultsTask; conditions: readonly ResultCondition[]; escalateTo: string; now: Date },
    typescriptAnswer: () => ResultsSettlement,
  ): ResultsSettlement | undefined {
    const { task, conditions, escalateTo, now } = question
    return ask(
      'resultsSettle',
      { task: wireTask(task), conditions: wireConditions(conditions), escalateToAssigneeId: escalateTo, now: now.toISOString() },
      raw => {
        const reply = JSON.parse(raw) as { ok: boolean; value?: Record<string, unknown> }
        return reply.ok ? settlementFrom(reply.value) : null
      },
      typescriptAnswer,
      differingSettle,
      { from: task.completed ? 'done' : task.statusRole === 'results' ? 'results' : 'other', conditions: conditions.length },
    )
  }

  return { write, settle, stats }
}

/**
 * Load the vendored core and install it behind lib/results-rules.ts. Called from instrumentation.ts
 * on the Node runtime next to the Waiting lane. Returns whether the core is installed; never throws.
 */
export function installResultsCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  if (mode === 'off') {
    setResultsCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; Pending results is decided by the TypeScript')
      return false
    }
    const hook = createResultsCore(
      core.runJson,
      {
        disagreement: details => log.warn(details, 'results: astrid-core and the TypeScript disagree'),
        failure: details => log.error(details, 'results: astrid-core could not answer; the TypeScript answer was used'),
      },
      { revision: core.revision, mode, sampleEvery: sampleEveryFrom() },
    )
    setResultsCore({ write: hook.write, settle: hook.settle })
    log.info({ revision: core.revision, mode }, 'results: astrid-core installed')
    return true
  } catch (error) {
    setResultsCore(null)
    try {
      log.error({ err: error, mode }, 'results: astrid-core install failed; the TypeScript decides')
    } catch {
      // Never fatal.
    }
    return false
  }
}
