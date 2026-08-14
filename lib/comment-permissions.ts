/**
 * Who may edit or delete a comment, and who should hear about it.
 *
 * Both rules were written out in `/api/comments/:id` and `/api/v1/comments/:id`.
 * The delete rule in particular is four separate conditions ORed together, and
 * four-condition boolean expressions are exactly the kind of thing that drifts
 * by one clause without anyone noticing. (Task e0613ae5.)
 *
 * The audience helper only computes the set. It deliberately does NOT decide
 * whether to exclude the actor, because the two verbs genuinely differ:
 * comment_updated keeps the editor in and lets the client filter on
 * `data.userId`, while comment_deleted drops the actor server-side. Folding
 * that choice in here would make one of them wrong.
 */

import { canUserManageList } from '@/lib/list-permissions'

/** The shape both routes load for a permission decision. */
export interface CommentTaskContext {
  creatorId: string | null
  assigneeId: string | null
  lists: Array<{
    ownerId?: string | null
    listMembers?: Array<{ userId: string }> | null
  }>
}

/**
 * Editing is author-only. Not "author or admin" — a list admin can remove a
 * comment they object to, but nobody gets to put words in someone else's mouth.
 *
 * `commentAuthorId` is nullable because system-authored comments (state
 * changes, the `type` discriminator in the schema) have no author. Those have
 * no editor at all, which falls out of the comparison: null never equals a
 * user id.
 */
export function canEditComment(commentAuthorId: string | null, userId: string): boolean {
  return commentAuthorId !== null && commentAuthorId === userId
}

/**
 * Deleting is wider than editing: the author, the people responsible for the
 * task, and anyone who administers a list it sits on. Removing a comment is
 * moderation, so the people who own the surface can do it.
 */
export function canDeleteComment(
  commentAuthorId: string | null,
  task: CommentTaskContext,
  userId: string,
): boolean {
  // A system-authored comment (authorId null) has no author clause to satisfy;
  // it falls through to the task and list checks, which is what both routes
  // have always done.
  if (commentAuthorId !== null && commentAuthorId === userId) return true
  if (task.creatorId === userId) return true
  if (task.assigneeId === userId) return true
  return task.lists.some(list => canUserManageList({ id: userId }, list as never))
}

/**
 * Everyone who can see this comment: the task's creator and assignee, plus the
 * owner and members of every list the task is on.
 *
 * Returns the full set including the actor — see the note at the top of this
 * file for why that is the caller's decision, not this function's.
 */
export function commentAudience(task: CommentTaskContext): Set<string> {
  const userIds = new Set<string>()

  if (task.creatorId) userIds.add(task.creatorId)
  if (task.assigneeId) userIds.add(task.assigneeId)

  for (const list of task.lists) {
    if (list.ownerId) userIds.add(list.ownerId)
    for (const member of list.listMembers ?? []) {
      userIds.add(member.userId)
    }
  }

  return userIds
}
