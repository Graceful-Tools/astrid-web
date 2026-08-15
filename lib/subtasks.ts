import { prisma } from '@/lib/prisma'

/**
 * Subtask helpers. Astrid tasks form a hierarchy via Task.parentTaskId
 * (self-relation, SetNull on parent delete). These validators keep the
 * hierarchy sane at the API boundary.
 */

/**
 * Validate a proposed parentTaskId for a task create/update.
 * Returns an error message, or null if valid.
 *
 * - the parent must exist
 * - a task can't be its own parent
 * - re-parenting must not create a cycle (walk the ancestor chain)
 */
export async function validateParentTask(
  parentTaskId: string,
  forTaskId?: string
): Promise<string | null> {
  if (forTaskId && parentTaskId === forTaskId) {
    return 'A task cannot be its own parent'
  }

  const parent = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { id: true, parentTaskId: true },
  })
  if (!parent) return 'Parent task not found'

  // Cycle check: walk up from the proposed parent; if we reach forTaskId the
  // re-parent would create a loop. Bounded walk guards against bad data.
  if (forTaskId) {
    let current = parent.parentTaskId
    for (let depth = 0; current && depth < 25; depth++) {
      if (current === forTaskId) return 'Re-parenting would create a cycle'
      const next: { parentTaskId: string | null } | null = await prisma.task.findUnique({
        where: { id: current },
        select: { parentTaskId: true },
      })
      current = next?.parentTaskId ?? null
    }
  }

  return null
}

/**
 * How a request body wants `parentTaskId` changed. (Task b00a1f94)
 *
 * Both task routes need this and `v1` had it inlined; the web route had it not
 * at all, which is why the UI could not unnest a task. Shared so the two
 * clients cannot disagree about what "no parent" looks like on the wire — iOS
 * sends `''`, web sends `null`, and both must mean the same thing.
 *
 * `skip` is the important case: a PUT that never mentions `parentTaskId` must
 * leave the nesting alone rather than clearing it.
 */
export type ParentTaskUpdate =
  | { skip: true }
  | { skip: false; parentTaskId: string | null }

export function readParentTaskIdFromBody(body: { parentTaskId?: unknown }): ParentTaskUpdate {
  const raw = body?.parentTaskId

  if (raw === undefined) return { skip: true }
  if (raw === null || raw === '') return { skip: false, parentTaskId: null }
  if (typeof raw === 'string') return { skip: false, parentTaskId: raw }

  // Neither a string nor a clear-signal: ignore it rather than handing Prisma
  // something that is not an id.
  return { skip: true }
}
