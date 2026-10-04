/**
 * Repeating-task rollover decided by astrid-core — web phase 4 (AWTD-1063).
 *
 * On the Node runtime, every server-side completion of a repeating task (lib/repeating-task-handler.ts,
 * reached from PUT /api/v1/tasks/:id and every other update path through services/task.service.ts)
 * is put to astrid-core's `nextOccurrence` rule, and the core's answer is written. The TypeScript
 * (types/repeating.ts) answers too, every time, for the same two reasons as list permissions
 * (list-permissions-core.ts):
 *
 * - **Fail-safe.** Its answer is returned whenever the core cannot give one: not loaded, threw,
 *   sent an error envelope, or answered something that is not an answer.
 * - **Comparison.** A disagreement is logged once per distinct shape: which fields differed, the
 *   kind of pattern, whether the task is all-day and whether a zone other than UTC was given.
 *   Never a task id, a date, a pattern's values or the zone's name.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for every rule: unset decides with the
 * core, `shadow` keeps the TypeScript deciding and only compares, `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { isTaskNextOccurrence, setRepeatingCore } from '@/lib/repeating-rollover'
import type { TaskNextOccurrence, TaskNextOccurrenceInput } from '@/types/repeating'
import { coreRulesModeFrom, type CoreRulesMode, type CoreRulesStatus, type CoreStats } from './list-permissions-core'
import { loadCoreRules } from './wasm'

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
}

/** Distinct disagreements logged per process, at most. */
const MAX_LOGGED = 50

const FIELDS: ReadonlyArray<keyof TaskNextOccurrence> = ['nextDueDate', 'shouldTerminate', 'newOccurrenceCount']

const instantOf = (value: string | null) => (value === null ? null : new Date(value).getTime())

/** The fields on which two answers differ. Dates are compared as instants: the core omits milliseconds. */
function differingFields(a: TaskNextOccurrence, b: TaskNextOccurrence): string[] {
  return FIELDS.filter((field) =>
    field === 'nextDueDate' ? instantOf(a.nextDueDate) !== instantOf(b.nextDueDate) : a[field] !== b[field],
  )
}

/** The pattern's kind, from a fixed vocabulary: `daily`…, or `custom:weeks`. Never its values. */
function kindOf(input: TaskNextOccurrenceInput): string {
  const known = ['daily', 'weekly', 'monthly', 'yearly', 'custom']
  const repeating = known.includes(input.repeating) ? input.repeating : 'other'
  if (repeating !== 'custom') return repeating
  const unit = (input.pattern as { unit?: unknown } | null | undefined)?.unit
  return `custom:${typeof unit === 'string' && ['days', 'weeks', 'months', 'years'].includes(unit) ? unit : 'other'}`
}

/**
 * A {@link setRepeatingCore} hook backed by `runJson` (astrid-core `rules::run_json`). In `decide`
 * mode it returns the core's answer; in `shadow` mode `undefined`, so the TypeScript decides. A core
 * that THROWS is switched off for the rest of the process, as for permissions.
 */
export function createRepeatingCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const stats: CoreStats = { agreed: 0, disagreed: 0, skipped: 0, failed: 0 }
  const logged = new Set<string>()
  let failureLogged = false
  let tripped = false

  function fail(error: unknown): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ rule: 'nextOccurrence', revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  function next(input: TaskNextOccurrenceInput, typescriptAnswer: TaskNextOccurrence): TaskNextOccurrence | undefined {
    if (tripped) return fail('core switched off after it threw')

    const completion = input.completion instanceof Date ? input.completion.toISOString() : input.completion
    const due = input.currentDueDate instanceof Date ? input.currentDueDate.toISOString() : input.currentDueDate ?? null
    let raw: string
    try {
      raw = runJson(
        JSON.stringify({
          kind: 'nextOccurrence',
          repeating: input.repeating,
          pattern: input.pattern ?? null,
          currentDueDate: due,
          completion,
          repeatFrom: input.repeatFrom ?? null,
          occurrenceCount: input.occurrenceCount ?? 0,
          timeZone: input.timeZone ?? 'UTC',
          isAllDay: input.isAllDay ?? false,
        }),
      )
    } catch (error) {
      tripped = true
      return fail(error)
    }

    let core: TaskNextOccurrence
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: unknown; error?: { kind?: string } }
      if (!reply.ok || !reply.value) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      if (!isTaskNextOccurrence(reply.value)) throw new Error('core answered something that is not a next occurrence')
      const { nextDueDate, shouldTerminate, newOccurrenceCount } = reply.value
      core = { nextDueDate: nextDueDate === null ? null : new Date(nextDueDate).toISOString(), shouldTerminate, newOccurrenceCount }
    } catch (error) {
      return fail(error)
    }

    const differing = differingFields(core, typescriptAnswer)
    if (differing.length === 0) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const shape = {
          differing,
          kind: kindOf(input),
          allDay: input.isAllDay === true,
          zoned: (input.timeZone ?? 'UTC') !== 'UTC',
          repeatFrom: input.repeatFrom === 'DUE_DATE' ? 'DUE_DATE' : 'COMPLETION_DATE',
        }
        const signature = JSON.stringify(shape)
        if (logged.size < MAX_LOGGED && !logged.has(signature)) {
          logged.add(signature)
          report.disagreement({
            rule: 'nextOccurrence',
            ...shape,
            revision,
            mode,
            returned: mode === 'decide' ? 'core' : 'typescript',
            stats: { ...stats },
          })
        }
      } catch {
        // Reporting must never change an answer.
      }
    }

    return mode === 'decide' ? core : undefined
  }

  return { next, stats }
}

const STATUS_KEY = Symbol.for('astrid.repeating.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function repeatingCoreStatus(): CoreRulesStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it behind lib/repeating-rollover.ts. Called from
 * instrumentation.ts on the Node runtime. Returns whether the core is installed; never throws.
 */
export function installRepeatingCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  host[STATUS_KEY] = { mode, loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setRepeatingCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; repeating rollover is decided by the TypeScript')
      return false
    }
    const hook = createRepeatingCore(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'repeating: astrid-core and the TypeScript roll over differently'),
        failure: (details) => log.error(details, 'repeating: astrid-core could not answer; the TypeScript answer was used'),
      },
      { revision: core.revision, mode },
    )
    setRepeatingCore(hook.next)
    host[STATUS_KEY] = { mode, loaded: true, revision: core.revision, stats: hook.stats }
    log.info({ revision: core.revision, mode }, 'repeating: astrid-core installed')
    return true
  } catch (error) {
    setRepeatingCore(null)
    try {
      log.error({ err: error, mode }, 'repeating: astrid-core install failed; the TypeScript decides')
    } catch {
      // Never fatal.
    }
    return false
  }
}
