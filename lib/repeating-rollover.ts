/**
 * Where a repeating task goes next when it is completed — asked of astrid-core on the server
 * (AWTD-1063, web phase 4).
 *
 * The rule is astrid-core's `nextOccurrence`, the code the iOS and Mac apps run. On the Node
 * runtime, lib/core-rules/repeating-core.ts installs it here from instrumentation.ts. Its answer is
 * returned. types/repeating.ts `calculateTaskNextOccurrence` is the same rule in TypeScript. It is
 * computed first, every time, and it is the answer whenever the core declines: not installed
 * (scripts, tests, the edge, the stdio MCP server, `ASTRID_CORE_RULES=off`), threw, or answered
 * something that is not an answer. tests/lib/core-rules-repeating-parity.test.ts holds the two to
 * the same answers over the shared fixture.
 *
 * Pure: no database and no WebAssembly. The caller (lib/repeating-task-handler.ts) reads the task.
 */
import {
  calculateTaskNextOccurrence,
  type TaskNextOccurrence,
  type TaskNextOccurrenceInput,
} from '@/types/repeating'

/**
 * Answers one rollover, or returns `undefined` to leave it to the TypeScript. Given the
 * TypeScript's own answer so it can compare.
 */
export type RepeatingCore = (
  input: TaskNextOccurrenceInput,
  typescriptAnswer: TaskNextOccurrence,
) => TaskNextOccurrence | undefined

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
 * The next occurrence of a just-completed repeating task: astrid-core's answer where it is
 * installed, the TypeScript's otherwise. Throws only what the TypeScript throws (an unknown zone,
 * a completion that is not a date), which the caller prevents by validating first.
 */
export function nextOccurrenceForTask(input: TaskNextOccurrenceInput): TaskNextOccurrence {
  const typescriptAnswer = calculateTaskNextOccurrence(input)
  const core = (globalThis as CoreHost)[CORE_KEY]
  if (!core) return typescriptAnswer
  try {
    const answer = core(input, typescriptAnswer)
    return answer !== undefined && isTaskNextOccurrence(answer) ? answer : typescriptAnswer
  } catch {
    // A hook that throws must not fail the completion; the TypeScript answer stands.
    return typescriptAnswer
  }
}
