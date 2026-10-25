/**
 * May this person put a task on these lists?
 *
 * The one rule both task write paths apply (services/task.service.ts): a
 * list's owner and members may; anyone may on a collaborative public list,
 * which is exactly what makes it collaborative — so no role is required there.
 *
 * A GitHub label list asks for nothing here, whether the task carries the
 * label already or not (AWTD-1188, AWTD-1193). Nothing can be added to one
 * from Astrid by ANYONE — the label guard in lib/backends/github-labels.ts
 * refuses it by name with 400 `github_label_read_only`, and that guard runs
 * after this check. So a role test here could only decide WHICH error a
 * doomed write gets: the owner saw the named refusal and a board member saw a
 * bare 403 about a list they could not even open. One read-only thing, one
 * answer; this check steps aside and lets the guard give it.
 */

import { hasListAccess } from '@/lib/list-member-utils'
import { isGithubLabelList } from '@/lib/backends/github-labels'

interface AddTarget {
  id: string
  privacy?: string | null
  publicListType?: string | null
  listType?: string | null
  remoteNodeId?: string | null
}

/** The first list the actor may not add a task to, if any. */
export function listRefusingTask<T extends AddTarget>(lists: readonly T[], actorId: string): T | undefined {
  return lists.find(list => {
    if (isGithubLabelList(list)) return false
    const isCollaborativePublic = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'
    return !hasListAccess(list as never, actorId) && !isCollaborativePublic
  })
}
