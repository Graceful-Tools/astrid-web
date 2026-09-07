/**
 * Who may edit or delete a comment, and who should hear about it.
 *
 * Both rules were written out in `/api/comments/:id` and `/api/v1/comments/:id`.
 * The delete rule in particular is four separate conditions ORed together, and
 * four-condition boolean expressions are exactly the kind of thing that drifts
 * by one clause without anyone noticing. (Task e0613ae5.)
 *
 * The audience helper computes the set and applies the ONE rule about the
 * actor. The verbs used to disagree — comment_updated kept the editor in,
 * comment_created and comment_deleted dropped them — on the reasoning that the
 * actor already sees their own comment optimistically. That is true of the tab
 * that posted and of nothing else: a user is not a device, so commenting on Mac
 * and reading on web meant the web session was deliberately cut out of its own
 * event. Clients dedupe by comment id, which does not care how many devices a
 * user has. (Task cb1581e0.)
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

/** Whoever caused the comment event — the comment's AUTHOR, not the token owner. */
export interface CommentActor {
  id: string
  isAIAgent?: boolean | null
}

/**
 * The actor half of `commentAudience`, for the broadcast sites that build the
 * recipient set some other way — v1 and MCP resolve list members through
 * `getListMemberIds` / `getListMemberIdsByListId`, which understand list shapes
 * this file does not. They still have to agree about the actor, and that is the
 * rule that was wrong in four places, so it lives in exactly one. Mutates the
 * set it is given, which is how every call site already builds one.
 */
export function applyCommentActorRule(userIds: Set<string>, actor?: CommentActor | null): Set<string> {
  if (actor?.isAIAgent) userIds.delete(actor.id)
  return userIds
}

/**
 * Everyone who should hear about this comment: the task's creator and
 * assignee, plus the owner and members of every list the task is on.
 *
 * The actor stays in. Their other devices are separate SSE connections under
 * the same user id, and they are the whole reason a comment written on one
 * device has to reach the others.
 *
 * An AI-agent actor is the one exception. Agents register in the same
 * connection pool (app/api/v1/agent/events hands them comment_created as
 * task.commented), so an agent that answers comments on its own tasks would
 * answer itself. Agents have no second device, so nothing is lost by omitting
 * them. Pass the comment's author here, not the authenticated user: an agent
 * commenting through a human's MCP token used to exclude the human and keep
 * the agent, which is exactly backwards.
 */
export function commentAudience(
  task: CommentTaskContext,
  actor?: CommentActor | null,
): Set<string> {
  const userIds = new Set<string>()

  if (task.creatorId) userIds.add(task.creatorId)
  if (task.assigneeId) userIds.add(task.assigneeId)

  for (const list of task.lists) {
    if (list.ownerId) userIds.add(list.ownerId)
    for (const member of list.listMembers ?? []) {
      userIds.add(member.userId)
    }
  }

  return applyCommentActorRule(userIds, actor)
}
