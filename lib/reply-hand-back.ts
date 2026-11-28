/**
 * "Hand back": the quick way to return a task to whoever asked you something on it (ADEV-360).
 *
 * Jon: "we want a button on all platform. Kind of like 'send & Archive' with Gmail." Answering a
 * question in a task's comments left the task assigned to him, so the agent (or person) who asked
 * never got it back without a trip to the assignee picker. This rule says when the comment
 * composer offers the one-tap way back, and to whom; the composer only draws it.
 *
 * The same rule as astrid-ios `Astrid App/Core/Tasks/ReplyHandBack.swift` — change both together.
 *
 * - Offered only on an open task assigned to YOU — handing back something that isn't yours is
 *   reassignment, which the assignee picker already does.
 * - The asker is the author of the newest comment written by someone else. System lines (no
 *   author) and your own replies are skipped, so it still points at the asker after you answer.
 * - An agent goes back in **Ready**: an agent's queue is Ready tasks assigned to it, so assigning
 *   without Ready would hand it back to an agent that never looks. A person keeps the column.
 */

import type { Comment, Task, User } from '@/types/task'
import { READY_STATUS_ROLE } from '@/lib/task-status'

/** Who the task goes back to, and the board state the hand-back writes (null = unchanged). */
export interface HandBackTarget {
  userId: string
  name: string
  isAgent: boolean
  statusRole: string | null
}

type HandBackTask = Pick<Task, 'assigneeId' | 'completed' | 'comments'>

function allComments(comments: Comment[] | undefined): Comment[] {
  return (comments ?? []).flatMap(comment => [comment, ...allComments(comment.replies)])
}

function timeOf(comment: Comment): number {
  const value = comment.createdAt ? new Date(comment.createdAt).getTime() : NaN
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

/** The newest comment by someone other than `currentUserId`, or null. */
function askerComment(comments: Comment[] | undefined, currentUserId: string): Comment | null {
  const ordered = allComments(comments)
    .map((comment, index) => ({ comment, index }))
    // Oldest first by time; the given order breaks ties, so an untimed row keeps its place.
    .sort((a, b) => timeOf(a.comment) - timeOf(b.comment) || a.index - b.index)
    .map(entry => entry.comment)
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const authorId = ordered[i].authorId
    if (authorId && authorId !== currentUserId) return ordered[i]
  }
  return null
}

export function handBackTarget(task: HandBackTask, currentUserId: string | null | undefined): HandBackTarget | null {
  if (task.completed || !currentUserId || task.assigneeId !== currentUserId) return null
  const asked = askerComment(task.comments, currentUserId)
  if (!asked?.authorId) return null
  const isAgent = asked.author?.isAIAgent === true
  return {
    userId: asked.authorId,
    name: asked.author?.name || asked.author?.email || asked.authorId,
    isAgent,
    statusRole: isAgent ? READY_STATUS_ROLE : null,
  }
}

/**
 * The words on the one blue button: what a tap does, given whether something is typed. A person
 * keeps the column, so their button never says Ready.
 */
export function handBackTitleKey(target: HandBackTarget, hasReply: boolean): string {
  const base = 'tasks.commentsSection.handBack.'
  if (target.isAgent) return base + (hasReply ? 'replyReassignReady' : 'reassignReady')
  return base + (hasReply ? 'replyReassign' : 'reassign')
}

/**
 * The task, reassigned to `target`, for the task detail's own `onUpdate` — the path the assignee
 * picker uses. The PUT body reads `assignee`, not `assigneeId`, so both are set. `posted` are
 * comments that went out after `task` was read, so the optimistic write does not drop them.
 */
export function handedBackTask(task: Task, target: HandBackTarget, posted: Comment[] = []): Task {
  const known = allComments(task.comments).find(comment => comment.authorId === target.userId)?.author
  const assignee: User = known ?? {
    id: target.userId,
    name: target.name,
    email: '',
    createdAt: new Date(),
    isAIAgent: target.isAgent,
  }
  return {
    ...task,
    comments: posted.length ? [...(task.comments ?? []), ...posted] : task.comments,
    assigneeId: target.userId,
    assignee,
    ...(target.statusRole ? { statusRole: target.statusRole } : {}),
  }
}

/**
 * One tap: the reply first, then the hand-back, so whoever gets the task finds the answer already
 * there. `reply` is null when nothing is typed (a plain hand-back) and resolves false when it did
 * not go out — then the task stays with you. Resolves whether the hand-back was made.
 */
export async function replyThenHandBack(
  target: HandBackTarget,
  reply: (() => Promise<boolean>) | null,
  handBack: (target: HandBackTarget) => Promise<void>,
): Promise<boolean> {
  if (reply && !(await reply())) return false
  await handBack(target)
  return true
}
