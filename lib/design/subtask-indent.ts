/**
 * How far a subtask row indents: one `layout.subtask-indent` step (16 in both
 * densities) per depth, at most four deep (docs/specs/DESIGN_SYSTEM.md → Layout
 * and alignment; register DS12). A row deeper than four still shows, at four.
 */
export const SUBTASK_MAX_INDENT_DEPTH = 4

/** A CSS length for a `style` prop: the token times the capped depth. */
export function subtaskIndent(depth: number): string {
  const steps = Math.min(Math.max(depth, 0), SUBTASK_MAX_INDENT_DEPTH)
  return `calc(var(--astrid-layout-comfortable-subtask-indent) * ${steps})`
}
