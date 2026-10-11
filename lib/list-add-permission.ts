/**
 * May this person put a task on these lists?
 *
 * The one rule both task write paths apply (services/task.service.ts): a
 * list's owner and members may; anyone may on a collaborative public list,
 * which is exactly what makes it collaborative — so no role is required there.
 *
 * A GitHub label the task already carries is being KEPT, not added
 * (AWTD-1188), so it asks for nothing: a board member is not a member of the
 * label's list, and without this could not move a labelled task at all.
 */

import { hasListAccess } from '@/lib/list-member-utils'
import { isHeldGithubLabel } from '@/lib/backends/github-labels'

interface AddTarget {
  id: string
  privacy?: string | null
  publicListType?: string | null
  listType?: string | null
  remoteNodeId?: string | null
}

/** The first list the actor may not add a task to, if any. */
export function listRefusingTask<T extends AddTarget>(
  lists: readonly T[],
  actorId: string,
  alreadyOn?: ReadonlyArray<{ id: string }> | null,
): T | undefined {
  return lists.find(list => {
    if (isHeldGithubLabel(list, alreadyOn)) return false
    const isCollaborativePublic = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
    return !hasListAccess(list as never, actorId) && !isCollaborativePublic
  })
}
