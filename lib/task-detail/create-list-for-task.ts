/**
 * Creating a list from the task-detail Lists row — what list to make, and the
 * call that makes it.
 *
 * Lifted out of `components/task-detail.tsx` to make room under the
 * oversized-files ratchet for the subtasks section (AWTD-1227), in the pattern
 * that file's own budget history records twice: when a new row does not fit,
 * take the next self-contained block out rather than raising the number. The
 * LISTS ROW itself already moved to `TaskDetailListsRow.tsx`; this is the
 * decision that served only it, following it out.
 *
 * It is also the half worth testing. The state plumbing around it is three
 * setters; the part that can be WRONG is which privacy a new list inherits and
 * who administers it — get that wrong and a list meant for a shared board is
 * created private, visible to nobody else, with no error to show for it.
 */

import { apiPost } from '@/lib/api'
import { randomListColor } from '@/lib/brand/colors'
import { unwrapList } from '@/lib/v1-response'
import type { TaskList } from '@/types/task'

/** The part of a sibling list this decision reads. */
export interface SiblingList {
  privacy: TaskList['privacy']
  admins?: { id: string }[]
}

/**
 * The privacy a new list inherits from the lists the task is already on:
 * **PUBLIC beats SHARED beats PRIVATE.**
 *
 * Widest wins, because the new list has to be at least as reachable as the
 * task's existing audience. Taking the narrowest instead would create a list
 * the task's own collaborators cannot see.
 */
export function inheritedListPrivacy(siblings: SiblingList[]): TaskList['privacy'] {
  if (siblings.some(list => list.privacy === 'PUBLIC')) return 'PUBLIC'
  if (siblings.some(list => list.privacy === 'SHARED')) return 'SHARED'
  return 'PRIVATE'
}

/**
 * The admins a new SHARED list starts with: every admin of the task's shared
 * lists, deduplicated.
 *
 * Undefined — not an empty array — for a private or public list, so the field
 * is absent from the request rather than sent empty, which the API would read
 * as "no admins" instead of "not applicable".
 */
export function inheritedListAdminIds(
  siblings: SiblingList[],
  privacy: TaskList['privacy'],
): string[] | undefined {
  if (privacy !== 'SHARED') return undefined
  return Array.from(
    new Set(
      siblings
        .filter(list => list.privacy === 'SHARED')
        .flatMap(list => (list.admins ?? []).map(admin => admin.id)),
    ),
  )
}

/**
 * Create a list for a task, inheriting privacy and admins from the lists it is
 * already on. Throws if the API answers without one — the caller decides what
 * a failure looks like.
 */
export async function createListForTask(name: string, siblings: SiblingList[]): Promise<TaskList> {
  const privacy = inheritedListPrivacy(siblings)
  const response = await apiPost('/api/v1/lists', {
    name: name.trim(),
    color: randomListColor(),
    privacy,
    adminIds: inheritedListAdminIds(siblings, privacy),
  })
  // v1 wraps the new list in { list, meta }; legacy returned it bare.
  const created = unwrapList<TaskList>(await response.json())
  if (!created) throw new Error('List creation returned no list')
  return created
}
