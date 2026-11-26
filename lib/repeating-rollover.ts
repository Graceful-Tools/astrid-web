/**
 * Where a repeating task goes next when it is completed — asked of astrid-core on the server
 * (AWTD-1063, web phase 4; ADEV-306, step B of
 * docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md).
 *
 * The rule is astrid-core's `nextOccurrence`, the code the iOS and Mac apps run. On the Node
 * runtime, lib/core-rules/repeating-core.ts installs it here from instrumentation.ts. There is no
 * TypeScript copy of the rule: when the core is not installed, throws, or answers something that is
 * not an answer, the rollover is REFUSED with {@link RolloverUnavailableError} (a 503 the client
 * can retry), never a guessed date.
 *
 * Pure: no database and no WebAssembly. The caller (lib/repeating-task-handler.ts) reads the task.
 */
import type { TaskNextOccurrence, TaskNextOccurrenceInput } from '@/types/repeating'

/** The core could not give the next occurrence. Retry later; nothing was written. */
export class RolloverUnavailableError extends Error {
  readonly retryable = true
  constructor(reason: string) {
    super(`Repeating rollover is unavailable: ${reason}`)
    this.name = 'RolloverUnavailableError'
  }
}

/**
 * Answers one rollover, or returns `undefined` when it cannot (the rollover is then refused).
 */
export type RepeatingCore = (input: TaskNextOccurrenceInput) => TaskNextOccurrence | undefined

// On globalThis, as with the other core hooks: Next compiles this module into several layers, each
// with its own module state, and the core is installed once from instrumentation.ts.
const CORE_KEY = Symbol.for('astrid.repeating.core')
type CoreHost = { [CORE_KEY]?: RepeatingCore | null }

/** Install (or, with `null`, remove) astrid-core's `nextOccurrence` behind {@link nextOccurrenceForTask}. */
export function setRepeatingCore(core: RepeatingCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

const isInstant = (value: unknown) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime())

/** Is this an answer the handler can act on: a count, and a date exactly when the series goes on? */
export function isTaskNextOccurrence(value: unknown): value is TaskNextOccurrence {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.shouldTerminate === 'boolean' &&
    typeof v.newOccurrenceCount === 'number' &&
    Number.isInteger(v.newOccurrenceCount) &&
    (v.shouldTerminate ? v.nextDueDate === null : isInstant(v.nextDueDate))
  )
}

/**
 * The next occurrence of a just-completed repeating task, as astrid-core answers it. Throws
 * {@link RolloverUnavailableError} when the core is not installed or cannot answer.
 */
export function nextOccurrenceForTask(input: TaskNextOccurrenceInput): TaskNextOccurrence {
  const core = (globalThis as CoreHost)[CORE_KEY]
  if (!core) throw new RolloverUnavailableError('astrid-core is not loaded')
  let answer: TaskNextOccurrence | undefined
  try {
    answer = core(input)
  } catch {
    throw new RolloverUnavailableError('astrid-core threw')
  }
  if (answer === undefined || !isTaskNextOccurrence(answer)) {
    throw new RolloverUnavailableError('astrid-core did not answer')
  }
  return answer
}
