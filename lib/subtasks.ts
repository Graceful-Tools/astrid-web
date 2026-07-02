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
