/**
 * Making comment creation safe to retry.
 *
 * iOS queues comments written offline and replays them after a reconnect.
 * Without this, every replay produced a fresh row and the user saw their
 * comment three times. The client sends a `clientRequestId`; a repeat of the
 * same id returns the comment that already exists instead of making another.
 *
 * Both `/api/tasks/:id/comments` and `/api/v1/tasks/:id/comments` carried their
 * own copy of this — about thirty-five lines each, including the concurrency
 * fallback below, which is the part you least want two versions of.
 * (Task e0613ae5.)
 *
 * The `include` stays a parameter because the two routes return different
 * shapes: legacy nests `replies`, v1 returns them flat.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Long enough that a collision is not an accident, short enough to index. */
const MIN_LENGTH = 8
const MAX_LENGTH = 128

export type ClientRequestIdResult =
  | { ok: true; clientRequestId: string | null }
  | { ok: false; error: string }

/**
 * Normalise and bounds-check the caller's `clientRequestId`.
 *
 * Absent is fine — it just means the caller has not opted into retry safety.
 * Present but implausible is rejected, because an id that short would collide
 * between unrelated clients and start returning other people's comments.
 */
export function parseClientRequestId(raw: unknown): ClientRequestIdResult {
  const clientRequestId = typeof raw === 'string' ? raw.trim() : null

  if (clientRequestId !== null && (clientRequestId.length < MIN_LENGTH || clientRequestId.length > MAX_LENGTH)) {
    return {
      ok: false,
      error: `clientRequestId must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`,
    }
  }

  return { ok: true, clientRequestId }
}

/**
 * Find the comment a previous attempt with this id already created.
 *
 * Scoped to the same task AND the same author on purpose. `clientRequestId` is
 * unique globally, so without those checks a caller who guessed or replayed
 * someone else's id would be handed that person's comment. A mismatch returns
 * null rather than the row.
 */
export async function findCommentByClientRequestId<T extends Prisma.CommentInclude>(args: {
  clientRequestId: string
  taskId: string
  authorId: string
  include: T
}): Promise<Prisma.CommentGetPayload<{ include: T }> | null> {
  const { clientRequestId, taskId, authorId, include } = args

  const existing = await prisma.comment.findUnique({
    where: { clientRequestId },
    include: include as never,
  })

  if (!existing) return null
  if (existing.taskId !== taskId) return null
  if (existing.authorId !== authorId) return null

  return existing as unknown as Prisma.CommentGetPayload<{ include: T }>
}

/**
 * Did this write lose a race to a concurrent retry?
 *
 * P2002 is Prisma's unique-constraint violation. Two replays of the same queued
 * comment can arrive close enough together that both pass the lookup above and
 * both try to insert; the loser lands here and should return the winner's row,
 * not an error. This is the case that makes the whole mechanism actually
 * idempotent rather than merely usually-idempotent.
 */
export function isDuplicateClientRequestId(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
