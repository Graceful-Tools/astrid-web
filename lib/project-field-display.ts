/**
 * Which GitHub project fields the client shows, and in what order (AWTD-1210,
 * P6a-4).
 *
 * Spec §9.4, decision D4: on a GitHub-backed board every project field is
 * shown and editable in task detail. "Every" has two exceptions that are rules
 * rather than presentation, so they live here, pure, instead of inside a
 * component where they could not be tested without rendering one.
 *
 * The schema these describe comes from `GET /api/v1/projects/:id/fields`
 * (AWTD-1208), once per project rather than once per task.
 */

/** A field as the schema route serves it. Mirrors `ProjectFieldSchemaEntry` on the server. */
export interface ProjectFieldSchemaEntry {
  id: string
  remoteId: string
  name: string
  dataType: string
  options: unknown
  iterations: unknown
  mappedTo: string | null
  position: number
}

export interface FieldOptionChoice {
  id: string
  name: string
  color?: string | null
  description?: string | null
}

export interface IterationChoice {
  id: string
  title: string
  startDate: string
  duration: number
}

/** An iteration with the one fact the picker needs that GitHub does not state outright. */
export interface OrderedIterationChoice extends IterationChoice {
  completed: boolean
}

/** The five the server normalises. Anything else has no editor, so it is not shown. */
const EDITABLE_TYPES = new Set(['text', 'number', 'date', 'single_select', 'iteration'])

/**
 * The fields to render, in `position` order.
 *
 * **A mapped field never renders.** Status, priority and due are native Task
 * columns with their own rows in the pane already, so a second control would
 * offer two ways to set one value — and `planFieldValueWrite` refuses the
 * write anyway (AWTD-1209), so the control could only ever fail.
 *
 * **An unknown dataType is dropped, not rendered blank.** The server sends
 * only the five it normalises, but a newer server talking to an older client
 * is exactly the case where a row with no editor would appear.
 */
export function visibleProjectFields(
  fields: readonly ProjectFieldSchemaEntry[] | undefined | null,
): ProjectFieldSchemaEntry[] {
  if (!fields) return []
  return fields
    .filter(field => field.mappedTo === null && EDITABLE_TYPES.has(field.dataType))
    .sort((a, b) => a.position - b.position)
}

/** Options for a single-select, tolerant of the column being JSON of an unexpected shape. */
export function optionChoices(field: ProjectFieldSchemaEntry): FieldOptionChoice[] {
  return Array.isArray(field.options) ? (field.options as FieldOptionChoice[]) : []
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * An iteration field's choices: current and upcoming first, completed after.
 *
 * GitHub keeps completed iterations in the same `iterations` array as the live
 * ones, so ordering by start date alone would put a year-old sprint above this
 * week's. Completed ones are KEPT rather than filtered: a task already
 * pointing at one must still render its title instead of a bare id.
 *
 * An iteration runs for `duration` days from `startDate` inclusive, so one
 * ending today is still current; it is completed the day after.
 */
export function orderIterationChoices(
  iterations: readonly IterationChoice[] | unknown,
  now: Date = new Date(),
): OrderedIterationChoice[] {
  if (!Array.isArray(iterations)) return []
  const marked = (iterations as IterationChoice[]).map(iteration => {
    const start = Date.parse(`${iteration.startDate}T00:00:00Z`)
    const endsAfter = Number.isNaN(start) ? Number.POSITIVE_INFINITY : start + iteration.duration * DAY_MS
    return { ...iteration, completed: now.getTime() >= endsAfter }
  })
  // Stable within each group, by start date, so "upcoming" reads in order.
  const byStart = (a: IterationChoice, b: IterationChoice) => a.startDate.localeCompare(b.startDate)
  return [
    ...marked.filter(i => !i.completed).sort(byStart),
    ...marked.filter(i => i.completed).sort(byStart),
  ]
}
