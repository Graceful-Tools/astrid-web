/**
 * The one statement of what a task priority is (task 17fea642).
 *
 * Four surfaces independently asserted "0 to 3": mcp/schemas.ts as a zod
 * range, mcp/tool-definitions.ts as JSON-schema bounds, docs/API_CONTRACT.md
 * as prose, and types/task.ts as a union type. The v1 HTTP API asserted only
 * "a number", so `priority: 999` was written to the Int column and every
 * reader that had been promised 0|1|2|3 — the colour map in
 * lib/task-manager-utils.ts, the glyphs in lib/priority-glyph.ts — rendered
 * something nobody designed. A task created through MCP with the same body was
 * rejected at the door.
 *
 * Four copies of a rule is how the fifth surface ends up disagreeing, so the
 * numbers live here and the enforcing surfaces read them.
 *
 * Deliberately dependency-free: mcp/schemas.ts consumes it through `require`
 * (the MCP servers are tsc-compiled to CommonJS), so anything imported here
 * would follow it into the MCP bundle.
 */

export const MIN_TASK_PRIORITY = 0
export const MAX_TASK_PRIORITY = 3

/** `0 | 1 | 2 | 3` — the union in types/task.ts, as a runtime check. */
export function isValidTaskPriority(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TASK_PRIORITY &&
    value <= MAX_TASK_PRIORITY
  )
}
