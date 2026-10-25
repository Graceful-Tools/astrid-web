/**
 * GitHub iterations → membership in iteration-flavor lists (AWTD-1230, P6c-3b).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4, §9.4. The iteration half
 * of AWTD-1189, built on the milestone shape (milestones.ts) and the P6a field
 * store (fields.ts). Pure:
 *
 *   wantedIterations(values, fields)   stored iteration values → the lists a task belongs on
 *   planIterations(wanted, held)       the iteration lists to join and to leave
 *   iterationListDrift(name, it, list) a rename or a re-dating to carry over
 *   iterationWindow(it, now)           what the v1 list wire says: dates, and hidden
 *
 * **Why the lists come from `TaskFieldValue`, not from the item.** An iteration
 * is a project FIELD, and P6a already reads its value into the replica with the
 * rules that matter: a cut-short read clears nothing, an archived item's values
 * leave with it. Reading the item a second time here would mean restating those
 * rules, and two readers of one value are how they come to disagree.
 *
 * **Keyed by (field, iteration).** An iteration id is short and only unique
 * within its field, while `TaskList.remoteNodeId` is unique across the app. The
 * field's node id is global, so the pair is too.
 *
 * **Ended iterations stay, hidden** — Jon's decision (b), 2026-10-17. GitHub
 * keeps every completed iteration, so a weekly field carries ~52 a year. An
 * ended iteration's list keeps its tasks and stays reachable by search or link,
 * but is out of the normal list. "Ended" is derived from GitHub's own dates on
 * every read rather than stored, so it needs no job to flip it.
 *
 * Inbound only for MEMBERSHIP: joining or leaving an iteration list from Astrid
 * is refused by name (lib/backends/github-labels.ts). The iteration itself is
 * edited as a field value — `PUT /api/v1/tasks/:id/fields/:fieldId` (AWTD-1209)
 * — which writes through to GitHub; the list follows at the next hydration.
 */

import type { FieldIteration } from './fields'

/** An iteration-type ProjectField, as this module needs it. */
export interface IterationField {
  /** ProjectField.id */
  id: string
  /** GitHub's field node id (PVTIF_…). */
  remoteId: string
  name: string
  iterations: FieldIteration[] | null
}

const KEY_SEPARATOR = ':'

/** The `remoteNodeId` of an iteration's list. */
export function iterationListKey(fieldRemoteId: string, iterationId: string): string {
  return `${fieldRemoteId}${KEY_SEPARATOR}${iterationId}`
}

/** Null for anything that is not an iteration list's key — a label or milestone node id has no separator. */
export function parseIterationListKey(key: string | null | undefined): { fieldRemoteId: string; iterationId: string } | null {
  if (!key) return null
  const at = key.lastIndexOf(KEY_SEPARATOR)
  if (at <= 0 || at === key.length - 1) return null
  return { fieldRemoteId: key.slice(0, at), iterationId: key.slice(at + 1) }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The iteration's last day, YYYY-MM-DD. GitHub's `duration` is in days and counts the start day. */
export function iterationEndsOn(iteration: Pick<FieldIteration, 'startDate' | 'duration'>): string {
  const start = Date.parse(`${iteration.startDate.slice(0, 10)}T00:00:00Z`)
  return new Date(start + (Math.max(iteration.duration, 1) - 1) * DAY_MS).toISOString().slice(0, 10)
}

/** Past its last day. On the last day itself it is still running. Compared in UTC calendar days. */
export function isIterationEnded(iteration: Pick<FieldIteration, 'startDate' | 'duration'>, now: Date = new Date()): boolean {
  return now.toISOString().slice(0, 10) > iterationEndsOn(iteration)
}

/** An iteration list's window on the v1 wire. Clients that sync by delta compare `endsOn` themselves. */
export interface IterationWindow {
  startDate: string
  endsOn: string
  /** Decision (b): an ended iteration's list is out of the normal list, not gone. */
  hidden: boolean
}

export function iterationWindow(iteration: FieldIteration, now: Date = new Date()): IterationWindow {
  return {
    startDate: iteration.startDate.slice(0, 10),
    endsOn: iterationEndsOn(iteration),
    hidden: isIterationEnded(iteration, now),
  }
}

/**
 * A neutral cyan, the same for every iteration — GitHub gives an iteration no
 * colour. Distinct from the milestone slate so the two chips read apart.
 */
export const ITERATION_LIST_COLOR = '#0891b2'

/** `Sprint · 2026-10-05 – 2026-10-18`: the field tells two "Iteration 3"s apart, the dates say when. */
export function iterationListDescription(fieldName: string, iteration: FieldIteration): string {
  return `${fieldName} · ${iteration.startDate.slice(0, 10)} – ${iterationEndsOn(iteration)}`
}

export function iterationListDrift(
  fieldName: string,
  iteration: FieldIteration,
  list: { name: string; description?: string | null },
): { name?: string; description?: string } | null {
  const description = iterationListDescription(fieldName, iteration)
  const patch = {
    ...(iteration.title !== list.name ? { name: iteration.title } : {}),
    ...(description !== (list.description ?? null) ? { description } : {}),
  }
  return Object.keys(patch).length > 0 ? patch : null
}

export interface WantedIteration {
  key: string
  field: IterationField
  iteration: FieldIteration
}

/**
 * A task's stored iteration values → the lists it belongs on. A value whose
 * field or iteration the board no longer defines is skipped: the schema
 * refresh will either bring the iteration back or drop the value.
 */
export function wantedIterations(
  values: ReadonlyArray<{ fieldId: string; iterationId: string | null }>,
  fields: ReadonlyMap<string, IterationField>,
): WantedIteration[] {
  return values.flatMap(({ fieldId, iterationId }) => {
    const field = fields.get(fieldId)
    const iteration = iterationId ? field?.iterations?.find(candidate => candidate.id === iterationId) : undefined
    return field && iteration ? [{ key: iterationListKey(field.remoteId, iteration.id), field, iteration }] : []
  })
}

export interface IterationPlan {
  /** Iteration list keys the task joins. */
  join: string[]
  /** Iteration list keys the task leaves. */
  leave: string[]
}

/**
 * Join every wanted list, leave every other iteration list held. A field holds
 * one value, so moving a task from Sprint 41 to 42 leaves 41 — the way a
 * milestone move does, and for the same reason: nothing else would remove it.
 */
export function planIterations(wantedKeys: readonly string[], heldKeys: readonly string[]): IterationPlan {
  const wanted = new Set(wantedKeys)
  const held = new Set(heldKeys)
  return {
    join: [...wanted].filter(key => !held.has(key)),
    leave: [...held].filter(key => !wanted.has(key)),
  }
}

export function isEmptyIterationPlan(plan: IterationPlan): boolean {
  return plan.join.length === 0 && plan.leave.length === 0
}
