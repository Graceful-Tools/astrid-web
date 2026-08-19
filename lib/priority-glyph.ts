/**
 * The `○` / `!` / `!!` / `!!!` marks the app uses for priority.
 *
 * Task 4dd640d9. The task-detail priority row used a flag icon, which only ever
 * said "some field about importance". These marks are the vocabulary the app
 * already speaks — rows, quick add, the board and the options sheet all use
 * them — so the row is recognisable without reading its label.
 *
 * Mirrors `PriorityGlyph` on iOS/Mac, including `rowIcon` for the row marker.
 *
 * Collected here because the strings were already written out in at least four
 * places (lib/task-manager-utils.ts, lib/task-state-change-tracker.ts,
 * components/ui/priority-picker.tsx, components/priority-assignee-picker.tsx).
 * That is the shape docs/CODE_REUSE_AND_CONSISTENCY.md warns about: a
 * vocabulary duplicated per renderer drifts one renderer at a time.
 */

export const PRIORITY_GLYPHS = ['○', '!', '!!', '!!!'] as const

export type PriorityValue = 0 | 1 | 2 | 3

/** The mark for a given priority; `○` for none, and for anything unexpected. */
export function priorityGlyph(priority: number | null | undefined): string {
  if (typeof priority !== 'number') return PRIORITY_GLYPHS[0]
  const index = Math.trunc(priority)
  return PRIORITY_GLYPHS[index] ?? PRIORITY_GLYPHS[0]
}

/**
 * The marker for the priority ROW in task details — always `!!!`, whatever the
 * task's own priority.
 *
 * It labels the field, it does not report the value: the value is the picker
 * sitting next to it. Same rule as iOS's `PriorityGlyph.rowIcon`, and the
 * reason the row does not change glyph as you edit the priority.
 */
export const PRIORITY_ROW_GLYPH = '!!!'
