/**
 * Moving a task between the statuses — Ready, Doing, Waiting.
 *
 * Status IS a field on the task now (`Task.statusRole`, task AWTD-562), and that
 * field is the source of truth. What remains here is the membership half of the
 * dual-write: iOS still resolves board columns from the account-wide
 * `listType: 'status'` lists, so while those rows exist a task sits on TWO kinds
 * of list at once — its board (Astrid iOS To-do) and its status (Ready). "Move
 * it to Doing" means swapping only the second, and `PUT /api/v1/tasks/[id]`
 * takes `listIds` as the COMPLETE set — it replaces, it does not merge.
 *
 * So the obvious implementation is the destructive one. `scripts/move-task-to-list.ts`
 * sends `listIds: [target.id]`, which is right for its job (moving a task from one
 * board to another) and catastrophic for this one: the task lands on Doing and falls
 * off its board, out of every queue, findable only by id. Its own header records the
 * near-identical bug that prompted it.
 *
 * That is why the arithmetic lives here as a pure function with tests rather than
 * inline in a script: it is the part that goes wrong silently, and the damage is
 * invisible until someone asks where a task went.
 */

export interface TaskListMembership {
  id: string
  name?: string | null
  listType?: string | null
}

/** The three statuses a loop moves a task between. */
export const STATUS_READY = 'Ready'
export const STATUS_DOING = 'Doing'
export const STATUS_WAITING = 'Waiting'

export const STATUS_LIST_NAMES = [STATUS_READY, STATUS_DOING, STATUS_WAITING] as const
export type StatusListName = (typeof STATUS_LIST_NAMES)[number]

/**
 * Is this membership a status list rather than a board?
 *
 * Prefers `listType`, which is what the server actually models. Falls back to the
 * name only when the type is absent, because a user's own list called "Waiting"
 * would otherwise be mistaken for the status one — a fallback that is a guess, and
 * narrow on purpose.
 */
export function isStatusList(list: TaskListMembership): boolean {
  if (list.listType) return list.listType === 'status'
  return STATUS_LIST_NAMES.includes((list.name ?? '') as StatusListName)
}

/**
 * The complete `listIds` to PUT so the task ends up on `targetStatusListId` and no
 * other status list, keeping every board membership exactly as it was.
 *
 * `null` means no list backs this status — the rows are on their way out, and the
 * field carries the status on its own. The stale memberships are still stripped,
 * because a task left on the old status list would keep rendering in the old
 * column for any client still reading membership.
 *
 * Idempotent: moving a task to the status it already has returns the same set.
 */
export function listIdsForStatusChange(
  current: TaskListMembership[],
  targetStatusListId: string | null,
): string[] {
  const kept = current.filter(list => !isStatusList(list)).map(list => list.id)
  // Deduplicate rather than assume: the same list appearing twice in the payload
  // is not worth a failed write, and the set is small enough that this is free.
  return Array.from(new Set(targetStatusListId ? [...kept, targetStatusListId] : kept))
}

/**
 * Guard for the caller: a status change that would leave the task on NOTHING but a
 * status list has lost its board, and should not be written.
 *
 * Returns the reason it is unsafe, or null when it is fine. A string rather than a
 * bool so the script can say what is wrong instead of just refusing.
 */
export function unsafeStatusChangeReason(
  current: TaskListMembership[],
  targetStatusListId: string | null,
): string | null {
  if (current.length === 0) {
    return 'the task has no list memberships at all — refusing to write a status onto nothing'
  }
  const boards = current.filter(list => !isStatusList(list))
  if (boards.length === 0) {
    return 'the task is on no board, only status lists — moving it would strand it'
  }
  // `null` is deliberate — no row backs this status, and the field carries it.
  // An empty string is not: that is a list object whose id failed to resolve,
  // and PUTting it would attach the task to nothing under a plausible-looking
  // payload.
  if (targetStatusListId === '') {
    return 'no target status list id was resolved'
  }
  return null
}
