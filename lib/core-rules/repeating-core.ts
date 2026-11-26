/**
 * Repeating-task rollover decided by astrid-core — web phase 4 (AWTD-1063).
 *
 * On the Node runtime, every server-side completion of a repeating task (lib/repeating-task-handler.ts,
 * reached from PUT /api/v1/tasks/:id and every other update path through services/task.service.ts)
 * is put to astrid-core's `nextOccurrence` rule, and the core's answer is written. The TypeScript
 * (types/repeating.ts) is the fail-safe: its answer is returned whenever the core cannot give one
 * (not loaded, threw, sent an error envelope, or answered something that is not an answer). The
 * server comparison was retired (AWTD-1608, step A of
 * docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md), so a rollover the core answers runs no
 * TypeScript; the repeating fixture parity test still holds the two together.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for every rule: unset decides with the
 * core, `shadow` keeps the TypeScript deciding without asking the core, `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { isTaskNextOccurrence, setRepeatingCore } from '@/lib/repeating-rollover'
import type { TaskNextOccurrence, TaskNextOccurrenceInput } from '@/types/repeating'
import { coreRulesModeFrom, type CoreRulesMode } from './list-permissions-core'
import { createCoreAsker, type FailureReporter, type RetiredRuleStatus } from './core-asker'
import { loadCoreRules } from './wasm'

/** The core's reply as an answer the handler can act on, or a throw. */
function readNext(value: unknown): TaskNextOccurrence {
  if (!value || !isTaskNextOccurrence(value)) throw new Error('core answered something that is not a next occurrence')
  const { nextDueDate, shouldTerminate, newOccurrenceCount } = value
  return { nextDueDate: nextDueDate === null ? null : new Date(nextDueDate).toISOString(), shouldTerminate, newOccurrenceCount }
}

/**
 * A {@link setRepeatingCore} hook backed by `runJson` (astrid-core `rules::run_json`). In `decide`
 * mode it returns the core's answer, or `undefined` for the TypeScript fallback; in `shadow` mode
 * always `undefined`. A core that THROWS is switched off for the rest of the process.
 */
export function createRepeatingCore(
  runJson: (request: string) => string,
  report: FailureReporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const core = createCoreAsker('nextOccurrence', runJson, report, { revision, mode })

  function next(input: TaskNextOccurrenceInput): TaskNextOccurrence | undefined {
    const completion = input.completion instanceof Date ? input.completion.toISOString() : input.completion
    const due = input.currentDueDate instanceof Date ? input.currentDueDate.toISOString() : input.currentDueDate ?? null
    return core.ask(
      {
        kind: 'nextOccurrence',
        repeating: input.repeating,
        pattern: input.pattern ?? null,
        currentDueDate: due,
        completion,
        repeatFrom: input.repeatFrom ?? null,
        occurrenceCount: input.occurrenceCount ?? 0,
        timeZone: input.timeZone ?? 'UTC',
        isAllDay: input.isAllDay ?? false,
      },
      readNext,
    )
  }

  return { next, stats: core.stats }
}

const STATUS_KEY = Symbol.for('astrid.repeating.coreStatus')
type StatusHost = { [STATUS_KEY]?: RetiredRuleStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function repeatingCoreStatus(): RetiredRuleStatus | null {
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
  host[STATUS_KEY] = { mode, compare: 'retired', loaded: false, revision: null, stats: null }
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
        failure: (details) => log.error(details, 'repeating: astrid-core could not answer; the TypeScript answer was used'),
      },
      { revision: core.revision, mode },
    )
    setRepeatingCore(hook.next)
    host[STATUS_KEY] = { mode, compare: 'retired', loaded: true, revision: core.revision, stats: hook.stats }
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
