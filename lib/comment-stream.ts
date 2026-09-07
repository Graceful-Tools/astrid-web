/**
 * Reconciling comments arriving from several places into one rendered thread.
 *
 * A task's comments reach the client three ways — the optimistic row the input
 * bar writes, the full list a refresh fetches, and the SSE events other devices
 * and other people generate — and the merge rules for them were written inline
 * in components/task-detail.tsx (1,571 lines) and CommentSection.tsx, where
 * nothing could test them. Three bugs had accumulated there (task cb1581e0):
 *
 *  - Every SSE handler skipped events whose `data.userId` was the current user,
 *    on the reasoning that the optimistic update already covered it. That is a
 *    one-device assumption. Commenting on Mac and reading on web is one user id
 *    on two connections, so the web session dropped its own comments. Dedupe by
 *    comment id instead: it is what actually prevents double-rendering, and it
 *    does not care how many devices someone has.
 *
 *  - The API returns comments FLAT, each carrying `parentCommentId` (the Prisma
 *    include has no `replies` relation), but the renderer walks `comment.replies`
 *    and does not filter parented rows out of the top level. A reply posted
 *    optimistically was nested; the same reply after a refresh jumped to the top
 *    of the thread. `nestComments` is the missing translation.
 *
 *  - With the author back in their own SSE audience, an echo can beat the POST
 *    response home, so swapping the optimistic row by id alone can leave the
 *    server comment in the thread twice. `settleOptimisticComment` collapses it.
 *
 * Everything here is pure and non-mutating: callers hold this state in React.
 */

import type { Comment } from '@/types/task'

const time = (value: Comment['createdAt']) => new Date(value).getTime()

const byCreatedAt = (a: Comment, b: Comment) => time(a.createdAt) - time(b.createdAt)

/** Every id in the thread, replies included. */
function collectIds(comments: Comment[], into: Set<string> = new Set()): Set<string> {
  for (const comment of comments) {
    into.add(comment.id)
    if (comment.replies?.length) collectIds(comment.replies, into)
  }
  return into
}

/**
 * Turn a mixed flat/nested list into the nested shape the thread renders.
 *
 * Idempotent, so it is safe to run over state that is already nested — which
 * matters because the same array is written by a refresh (flat) and by the
 * optimistic path (already nested).
 *
 * A reply whose parent is absent stays at the top level rather than vanishing.
 * The parent can genuinely be gone: the response cap can cut it off, and a
 * reply outliving a deleted parent is still someone's message.
 */
export function nestComments(comments: Comment[]): Comment[] {
  // Flatten first so an already-nested input is reconciled rather than doubled.
  const flat: Comment[] = []
  const seen = new Set<string>()
  const push = (comment: Comment) => {
    if (seen.has(comment.id)) return
    seen.add(comment.id)
    const { replies, ...rest } = comment
    flat.push(rest as Comment)
    for (const reply of replies ?? []) push(reply)
  }
  for (const comment of comments) push(comment)

  const topLevel: Comment[] = []
  const repliesByParent = new Map<string, Comment[]>()

  for (const comment of flat) {
    const parentId = comment.parentCommentId
    if (parentId && seen.has(parentId)) {
      const bucket = repliesByParent.get(parentId)
      if (bucket) bucket.push(comment)
      else repliesByParent.set(parentId, [comment])
    } else {
      topLevel.push(comment)
    }
  }

  return topLevel
    .sort(byCreatedAt)
    .map(comment => ({
      ...comment,
      replies: (repliesByParent.get(comment.id) ?? []).sort(byCreatedAt),
    }))
}

/**
 * Add a comment the client has just learned about, or merge it into the copy
 * already on screen. Identity is the comment id and nothing else — the author
 * is deliberately not consulted.
 */
export function upsertComment(comments: Comment[], incoming: Comment): Comment[] {
  if (collectIds(comments).has(incoming.id)) {
    return updateComment(comments, incoming)
  }
  return nestComments([...comments, incoming])
}

/** True when `incoming` would not change a single field of `comment`. */
function isNoOp(comment: Comment, incoming: Partial<Comment> & { id: string }): boolean {
  const before = comment as unknown as Record<string, unknown>
  const after = incoming as unknown as Record<string, unknown>
  return Object.keys(after).every(key => before[key] === after[key])
}

/**
 * Apply an edit to a comment or to one of its replies.
 *
 * Returns the array it was given, unchanged, when there is nothing to apply —
 * an unknown id, or an update whose every field already matches. Callers hold
 * this in React state and use the identity to decide whether to write, so a
 * repeated SSE echo must not look like a change.
 */
export function updateComment(
  comments: Comment[],
  incoming: Partial<Comment> & { id: string },
): Comment[] {
  let changed = false

  const next = comments.map(comment => {
    const replies = comment.replies
    const replyIndex = replies?.findIndex(reply => reply.id === incoming.id) ?? -1
    let nextReplies = replies

    if (replies && replyIndex >= 0 && !isNoOp(replies[replyIndex], incoming)) {
      changed = true
      nextReplies = replies.map(reply =>
        reply.id === incoming.id ? { ...reply, ...incoming } : reply,
      )
    }

    if (comment.id === incoming.id && !isNoOp(comment, incoming)) {
      changed = true
      return { ...comment, ...incoming, replies: nextReplies }
    }
    return nextReplies === replies ? comment : { ...comment, replies: nextReplies }
  })

  return changed ? next : comments
}

/**
 * Remove a comment or a reply, wherever it sits in the thread. Identity-stable
 * like `updateComment`: an id that is not there gives back the same array.
 */
export function removeComment(comments: Comment[], commentId: string): Comment[] {
  let changed = false

  const next = comments
    .filter(comment => {
      if (comment.id !== commentId) return true
      changed = true
      return false
    })
    .map(comment => {
      const replies = comment.replies
      if (!replies?.some(reply => reply.id === commentId)) return comment
      changed = true
      return { ...comment, replies: replies.filter(reply => reply.id !== commentId) }
    })

  return changed ? next : comments
}

/**
 * Replace the optimistic row for `tempId` with the comment the server stored.
 *
 * When the SSE echo of the same comment has already landed, the optimistic row
 * is simply dropped: replacing it would put the server comment in the thread
 * twice.
 */
export function settleOptimisticComment(
  comments: Comment[],
  tempId: string,
  serverComment: Comment,
): Comment[] {
  const withoutTemp = removeComment(comments, tempId)
  return upsertComment(withoutTemp, serverComment)
}
