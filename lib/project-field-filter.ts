/**
 * Filtering a GitHub board by one project field (AWTD-1259, P6a-5).
 *
 * Spec §9.4, decision D4: every project field is "filterable on the board".
 * Jon chose storage (a) — one scalar view preference, `filterProjectField`,
 * holding `"<fieldId>:<valueId>"`. It persists per user per list exactly like
 * the seven filters beside it (lib/list-view-preferences.ts), and allows one
 * project-field filter at a time.
 *
 * Pure, so the rules are pinned by tests rather than buried in a component:
 *
 * - **Only unmapped single-select and iteration fields filter.** Those are the
 *   two kinds with a closed set of values to pick from. A mapped field is a
 *   native column (status, priority, due) that already has its own control.
 * - **A stale filter resolves to nothing**, not to "match nothing". A field
 *   deleted on GitHub, or an option removed from it, would otherwise leave a
 *   saved preference silently blanking the board with no control showing why.
 */

import {
  optionChoices,
  orderIterationChoices,
  visibleProjectFields,
  type ProjectFieldSchemaEntry,
} from '@/lib/project-field-display'

export interface ProjectFieldFilter {
  fieldId: string
  valueId: string
}

const FILTERABLE_TYPES = new Set(['single_select', 'iteration'])

/** The fields a board can be filtered by, in `position` order. */
export function filterableProjectFields(
  fields: readonly ProjectFieldSchemaEntry[] | undefined | null,
): ProjectFieldSchemaEntry[] {
  return visibleProjectFields(fields).filter(field => FILTERABLE_TYPES.has(field.dataType))
}

/** The ids a filterable field's values can take. */
export function projectFieldValueIds(field: ProjectFieldSchemaEntry): string[] {
  if (field.dataType === 'single_select') return optionChoices(field).map(option => option.id)
  if (field.dataType === 'iteration' && Array.isArray(field.iterations)) {
    return (field.iterations as Array<{ id: string }>).map(iteration => iteration.id)
  }
  return []
}

export interface ProjectFieldFilterGroup {
  fieldId: string
  fieldName: string
  choices: Array<{ value: string; label: string }>
}

/**
 * What the filter control lists: one group per filterable field, each choice
 * carrying its stored value. Iterations come current-and-upcoming first, as in
 * the detail pane. A field with no values has nothing to pick, so no group.
 */
export function projectFieldFilterGroups(
  schema: readonly ProjectFieldSchemaEntry[] | undefined | null,
  now: Date = new Date(),
): ProjectFieldFilterGroup[] {
  return filterableProjectFields(schema)
    .map(field => {
      const values =
        field.dataType === 'iteration'
          ? orderIterationChoices(field.iterations, now).map(i => ({ id: i.id, label: i.title }))
          : optionChoices(field).map(o => ({ id: o.id, label: o.name }))
      return {
        fieldId: field.id,
        fieldName: field.name,
        choices: values.map(v => ({ value: formatProjectFieldFilter(field.id, v.id), label: v.label })),
      }
    })
    .filter(group => group.choices.length > 0)
}

export function formatProjectFieldFilter(fieldId: string, valueId: string): string {
  return `${fieldId}:${valueId}`
}

/**
 * Read the stored preference. Splits on the FIRST colon: field ids are uuids,
 * but option and iteration ids come from GitHub and are not ours to constrain.
 * Anything else — absent, `"all"`, half a pair — is no filter.
 */
export function parseProjectFieldFilter(raw: string | null | undefined): ProjectFieldFilter | null {
  if (!raw) return null
  const separator = raw.indexOf(':')
  if (separator <= 0 || separator === raw.length - 1) return null
  return { fieldId: raw.slice(0, separator), valueId: raw.slice(separator + 1) }
}

/**
 * The filter to apply, given the board's schema — or null when the stored
 * value no longer names a live, filterable field and value. An empty schema
 * (still loading, or a deployment without the capability) resolves to null.
 */
export function resolveProjectFieldFilter(
  raw: string | null | undefined,
  schema: readonly ProjectFieldSchemaEntry[] | undefined | null,
): ProjectFieldFilter | null {
  const filter = parseProjectFieldFilter(raw)
  if (!filter) return null
  const field = filterableProjectFields(schema).find(candidate => candidate.id === filter.fieldId)
  if (!field || !projectFieldValueIds(field).includes(filter.valueId)) return null
  return filter
}

/**
 * The GitHub-backed list of a project, if it has one — the only kind of board
 * with project fields, and so the only one that shows or applies this filter.
 */
export function githubBoardListFor<L extends { projectId?: string | null; backend?: string | null }>(
  lists: readonly L[],
  projectId: string | null | undefined,
): L | null {
  if (!projectId) return null
  return lists.find(list => list.projectId === projectId && list.backend === 'github_project') ?? null
}

/**
 * A task's field values: the task's own `fields` when it carries them (the
 * detail route, or an edit made in this session), else the board's fetched map.
 * The bulk sync omits `fields` for its payload budget, so most tasks need the map.
 */
export function projectFieldValuesOf(
  task: { id: string; fields?: Record<string, string | number> | null },
  fetched: ReadonlyMap<string, Record<string, string | number>>,
): Record<string, string | number> | undefined {
  return task.fields ?? fetched.get(task.id)
}

/** Whether a task's compact `fields` map passes the filter. No filter passes everything. */
export function matchesProjectFieldFilter(
  fields: Record<string, string | number> | null | undefined,
  filter: ProjectFieldFilter | null,
): boolean {
  if (!filter) return true
  return fields?.[filter.fieldId] === filter.valueId
}
