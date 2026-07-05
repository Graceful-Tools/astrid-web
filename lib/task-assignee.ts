import { prisma } from '@/lib/prisma'

/**
 * Whether `assigneeId` may be assigned a task belonging to `listIds` — i.e. is
 * an owner or member of at least one of those lists. Without this check the
 * task create/update endpoints accepted an arbitrary userId as assignee,
 * granting that user task access + notifications (unsolicited task planting).
 *
 * Self-assignment (assignee === the acting user) is always allowed by the
 * callers and does not need this query.
 */
export async function assigneeCanBeAssigned(assigneeId: string, listIds: string[]): Promise<boolean> {
  if (listIds.length === 0) return false
  const count = await prisma.taskList.count({
    where: {
      id: { in: listIds },
      OR: [
        { ownerId: assigneeId },
        { listMembers: { some: { userId: assigneeId } } },
      ],
    },
  })
  return count > 0
}
