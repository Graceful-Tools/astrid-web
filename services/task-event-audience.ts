/**
 * Who hears a task event: the actor's OTHER devices count (AWTD-1497).
 *
 * Task events used to drop the actor ("they are looking at it"). That is true
 * of the tab that made the change and of no other device the person has open,
 * so a task added on the phone reached the Mac only on the 60-second sync
 * timer. Comments made the same mistake and fixed it (lib/comment-permissions
 * → commentAudience); receivers dedupe by id, so the echo costs one read.
 *
 * The one exception is the same as for comments: an AI-agent actor. Agents
 * listen on this stream (task.assigned, task.updated) and have no second
 * device, so an echo could only make one react to its own write.
 *
 * Used by create, bulk create and delete. Update/complete still exclude the
 * actor on purpose — tests/services/completion-does-not-echo-to-actor.test.ts.
 */

import { prisma } from '@/lib/prisma'

/** Agent-ness never changes for a user id; cache it per process, bounded. */
const actorKind = new Map<string, boolean>()
const MAX_CACHED = 5_000

/** Test seam: forget cached actor kinds. */
export function resetActorKindCache(): void {
  actorKind.clear()
}

/** Is this user an AI agent? Unknown or unreadable → treated as a person. */
export async function isAgentActor(actorId: string): Promise<boolean> {
  const cached = actorKind.get(actorId)
  if (cached !== undefined) return cached
  let isAgent = false
  try {
    const user = await prisma.user.findUnique({ where: { id: actorId }, select: { isAIAgent: true } })
    isAgent = user?.isAIAgent === true
  } catch {
    // A failed lookup must not cost the event; a person is the safe default
    // (they gain an echo they dedupe; an agent would only gain one it ignores).
    return false
  }
  if (actorKind.size >= MAX_CACHED) actorKind.clear()
  actorKind.set(actorId, isAgent)
  return isAgent
}

/** Should the actor's own devices hear about their change? */
export async function actorHearsOwnChange(actorId: string): Promise<boolean> {
  return !(await isAgentActor(actorId))
}
