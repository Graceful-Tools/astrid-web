import { createRequire } from 'node:module'
import path from 'node:path'

// Repeating rollover is astrid-core's alone (ADEV-306): there is no TypeScript fallback, so the
// server refuses a completion when no core is installed. Tests that complete repeating tasks get
// the vendored core here, loaded on first use so files that never roll a series pay nothing.
// A test that wants the refusal calls setRepeatingCore(null).
const CORE_KEY = Symbol.for('astrid.repeating.core')
let runJson: ((request: string) => string) | undefined
;(globalThis as Record<symbol, unknown>)[CORE_KEY] = (input: Record<string, unknown>) => {
  if (!runJson) {
    const dir = path.join(process.cwd(), 'packages', 'astrid-rules', 'node', 'package.json')
    runJson = (createRequire(dir)('./astrid_rules_wasm.js') as { runJson(request: string): string }).runJson
  }
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value)
  const reply = JSON.parse(
    runJson(
      JSON.stringify({
        kind: 'nextOccurrence',
        repeating: input.repeating,
        pattern: input.pattern ?? null,
        currentDueDate: iso(input.currentDueDate) ?? null,
        completion: iso(input.completion),
        repeatFrom: input.repeatFrom ?? null,
        occurrenceCount: input.occurrenceCount ?? 0,
        timeZone: input.timeZone ?? 'UTC',
        isAllDay: input.isAllDay ?? false,
      }),
    ),
  ) as { ok: boolean; value?: { nextDueDate: string | null; shouldTerminate: boolean; newOccurrenceCount: number } }
  if (!reply.ok || !reply.value) return undefined
  const { nextDueDate, shouldTerminate, newOccurrenceCount } = reply.value
  return { nextDueDate: nextDueDate === null ? null : new Date(nextDueDate).toISOString(), shouldTerminate, newOccurrenceCount }
}
