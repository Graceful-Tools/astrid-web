/**
 * Writing a board's custom states — `Project.customStates`, not TaskList rows.
 *
 * A custom column used to be a `listType: 'status'` TaskList. That made a
 * *column* into a *list*: it appeared wherever lists appear, it needed per-user
 * deduplication, and a second member of a shared board could not read it
 * without being granted a list whose contents span every project its owner has.
 * `Project.customStates` was added as the real home (AWTD-562); this module is
 * the writer it was missing.
 *
 * Pure functions over the stored JSON, for two reasons: the arithmetic is the
 * part that goes wrong silently, and a JSON column can hold anything — a
 * hand-edited row, a value from an older build, a half-migrated project. Every
 * rule here has to hold against junk rather than assume a well-formed array.
 *
 * RENAME KEEPS THE ROLE. A task points at its column by `statusRole`. Minting
 * a fresh role on rename would orphan every task in that column: still in the
 * list view, in no column on the board. Removal has the same hazard, which is
 * why {@link removeCustomState} hands the removed role back — the caller has to
 * clear the tasks still carrying it.
 */

import { parseCustomStates, isDefaultStatusRole, DEFAULT_STATES, type StatusState } from '@/lib/task-status'

/** Longest name that fits a column header without truncating. */
export const MAX_STATUS_NAME_LENGTH = 40

export type CustomStateFailure = {
  error: 'invalid' | 'duplicate' | 'reserved' | 'not-found'
  message: string
}

export type CustomStateWrite =
  | CustomStateFailure
  /** `states` is the full replacement array; `state` is the one that changed. */
  | { states: StatusState[]; state: StatusState }

/** Slugify a name into a stable identifier fragment. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'status'
}

/**
 * Custom roles are namespaced.
 *
 * Without the prefix, a column named "Blocked" would mint the bare role
 * `blocked`, and promoting `blocked` to a default role later would silently
 * merge every project's custom column into the new shared one.
 */
function mintRole(name: string, taken: Set<string>): string {
  const base = `custom-${slugify(name)}`
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

/** Shared name checks. `ignoreRole` lets a state keep its own name on rename. */
function validateName(
  name: string,
  states: StatusState[],
  ignoreRole?: string,
): { trimmed: string } | CustomStateFailure {
  const trimmed = name.trim()

  if (!trimmed) {
    return { error: 'invalid', message: 'Status name cannot be empty' }
  }
  if (trimmed.length > MAX_STATUS_NAME_LENGTH) {
    return {
      error: 'invalid',
      message: `Status name is too long (${MAX_STATUS_NAME_LENGTH} characters max)`,
    }
  }
  // Checked against the NAME rather than its slug: "Ready" slugs to
  // `custom-ready`, which collides with nothing, yet would put a second
  // column called Ready on the board — the duplication this change removes.
  if (isDefaultStatusRole(trimmed.toLowerCase())) {
    return { error: 'reserved', message: `"${trimmed}" is a built-in status` }
  }
  const clash = states.some(
    state => state.role !== ignoreRole && state.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (clash) {
    return { error: 'duplicate', message: 'A status with that name already exists' }
  }

  return { trimmed }
}

function isFailure(value: object): value is CustomStateFailure {
  return 'error' in value
}

export interface AddCustomStateOptions {
  /**
   * Roles that are taken but do not appear in `raw`.
   *
   * On a board whose custom columns predate `customStates`, the roles live on
   * legacy `listType: 'status'` rows. Minting against `raw` alone would hand
   * out a role a row already holds, and the two would merge into one column
   * the moment the reader starts deduplicating by role.
   */
  takenRoles?: Iterable<string>
}

/** Direction for reorder operations. */
export type ReorderDirection = 'up' | 'down'

/**
 * Move a custom state one slot in the given direction.
 *
 * Only custom columns are reorderable: the three default roles (ready/doing/
 * waiting) have a fixed semantic order shared by every board and cannot be
 * repositioned. The `order` values of the two swapped states are exchanged so
 * the relative position of every other state is preserved.
 *
 * If the target is already at the boundary (first when moving up, last when
 * moving down) the function is a no-op and returns the unchanged array.
 */
export function reorderCustomState(
  raw: unknown,
  role: string,
  direction: ReorderDirection,
): CustomStateWrite {
  if (isDefaultStatusRole(role)) {
    return { error: 'reserved', message: 'Built-in status order cannot be changed' }
  }

  const allStates = parseCustomStates(raw)
  const defaultOverrides = allStates.filter(s => isDefaultStatusRole(s.role))
  const customs = allStates.filter(s => !isDefaultStatusRole(s.role))

  const sorted = [...customs].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex(s => s.role === role)
  if (idx === -1) {
    return { error: 'not-found', message: 'That status does not exist on this board' }
  }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= sorted.length) {
    // Already at the boundary — no-op.
    return { states: [...defaultOverrides, ...sorted], state: sorted[idx] }
  }

  const updated = sorted.map((s, i) => {
    if (i === idx) return { ...s, order: sorted[swapIdx].order }
    if (i === swapIdx) return { ...s, order: sorted[idx].order }
    return s
  })

  const state = updated.find(s => s.role === role)!
  return { states: [...defaultOverrides, ...updated], state }
}

/**
 * Store a per-board name override for one of the three built-in columns.
 *
 * The defaults (Ready/Doing/Waiting) are shared config constants — there is no
 * row to rename. This writes an override entry into `customStates` so the board
 * can show a different label while still routing tasks by the original role.
 * `getProjectBoardColumns` / `boardColumnsFor` apply it at render time.
 *
 * The role is preserved: tasks still point at "ready", "doing", or "waiting".
 * Only the display name changes.
 */
export function renameBuiltinState(raw: unknown, role: string, name: string): CustomStateWrite {
  if (!isDefaultStatusRole(role)) {
    return { error: 'invalid', message: 'Use renameCustomState for custom columns' }
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return { error: 'invalid', message: 'Status name cannot be empty' }
  }
  if (trimmed.length > MAX_STATUS_NAME_LENGTH) {
    return { error: 'invalid', message: `Status name is too long (${MAX_STATUS_NAME_LENGTH} characters max)` }
  }

  // Prevent a built-in from being renamed to another built-in's default name.
  // Allow renaming it back to its OWN original name (e.g. "Starting" → "Ready").
  const defaultState = DEFAULT_STATES.find(s => s.role === role)!
  if (
    isDefaultStatusRole(trimmed.toLowerCase()) &&
    trimmed.toLowerCase() !== defaultState.name.toLowerCase()
  ) {
    return { error: 'reserved', message: `"${trimmed}" is a built-in status` }
  }

  // Check for name clashes with any state on this board.
  const allStates = parseCustomStates(raw)
  const clash = allStates.some(
    s => s.role !== role && s.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (clash) {
    return { error: 'duplicate', message: 'A status with that name already exists' }
  }

  const existing = allStates.find(s => s.role === role)
  const state: StatusState = {
    role,
    name: trimmed,
    order: existing?.order ?? defaultState.order,
  }
  // Replace any existing override for this role, then append the new one.
  const states = allStates.filter(s => s.role !== role)
  return { states: [...states, state], state }
}


export function addCustomState(
  raw: unknown,
  name: string,
  options: AddCustomStateOptions = {},
): CustomStateWrite {
  const states = parseCustomStates(raw)
  const checked = validateName(name, states)
  if (isFailure(checked)) return checked

  const taken = new Set<string>(states.map(s => s.role))
  for (const role of options.takenRoles ?? []) {
    if (role) taken.add(role)
  }

  const maxOrder = states.reduce((max, state) => Math.max(max, state.order), -1)
  const state: StatusState = {
    role: mintRole(checked.trimmed, taken),
    name: checked.trimmed,
    order: maxOrder + 1,
  }

  return { states: [...states, state], state }
}

/** Rename a custom state in place. The role is deliberately preserved. */
export function renameCustomState(raw: unknown, role: string, name: string): CustomStateWrite {
  const states = parseCustomStates(raw)
  const existing = states.find(state => state.role === role)
  if (!existing) {
    return { error: 'not-found', message: 'That status does not exist on this board' }
  }

  const checked = validateName(name, states, role)
  if (isFailure(checked)) return checked

  const state: StatusState = { ...existing, name: checked.trimmed }
  return {
    states: states.map(candidate => (candidate.role === role ? state : candidate)),
    state,
  }
}

/**
 * Remove a custom state.
 *
 * Returns the removed state so the caller can clear `statusRole` on the tasks
 * still pointing at it. Dropping the column without that leaves those tasks
 * matching no column — gone from the board while still in the list view.
 */
export function removeCustomState(raw: unknown, role: string): CustomStateWrite {
  if (isDefaultStatusRole(role)) {
    return { error: 'reserved', message: 'Built-in statuses cannot be removed' }
  }

  const states = parseCustomStates(raw)
  const existing = states.find(state => state.role === role)
  if (!existing) {
    return { error: 'not-found', message: 'That status does not exist on this board' }
  }

  return { states: states.filter(state => state.role !== role), state: existing }
}
