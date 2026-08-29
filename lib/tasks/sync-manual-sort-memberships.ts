import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { getListMemberIds } from '@/lib/list-member-utils'
import { broadcastToUsers } from '@/lib/sse-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.sync-manual-sort-memberships')

export interface SyncManualSortMembershipsOptions {
  taskId: string
  previousListIds: string[]
  requestedListIds: string[]
}

export async function syncManualSortMemberships({
  taskId,
  previousListIds,
  requestedListIds,
}: SyncManualSortMembershipsOptions): Promise<void> {
  const candidateIds = Array.from(new Set([...previousListIds, ...requestedListIds]))
  if (candidateIds.length === 0) return

  let candidateLists
  try {
    candidateLists = await prisma.taskList.findMany({
      where: { id: { in: candidateIds }, sortBy: 'manual' },
      select: {
        id: true,
        manualSortOrder: true,
      },
    })
  } catch (error) {
    log.error({ err: error }, 'Failed to load manual-sort lists')
    return
  }

  const requested = new Set(requestedListIds)
  await Promise.all(candidateLists.map(async listRecord => {
    const existingOrder = Array.isArray(listRecord.manualSortOrder)
      ? listRecord.manualSortOrder.filter((id): id is string => typeof id === 'string')
      : []
    const nextOrder = existingOrder.filter(id => id !== taskId)
    if (requested.has(listRecord.id)) nextOrder.push(taskId)

    const hasChanged =
      nextOrder.length !== existingOrder.length ||
      nextOrder.some((id, index) => existingOrder[index] !== id)
    if (!hasChanged) return

    try {
      const updatedList = await prisma.taskList.update({
        where: { id: listRecord.id },
        data: { manualSortOrder: nextOrder as Prisma.JsonArray },
        include: {
          owner: { select: { id: true, name: true, email: true, image: true } },
          listMembers: { select: { userId: true, role: true } },
        },
      })
      const memberIds = getListMemberIds(updatedList)
      await Promise.all(
        memberIds.map(userId => RedisCache.invalidate.userListsAllVersions(userId)),
      )
      await broadcastToUsers(memberIds, {
        type: 'list_updated',
        data: updatedList,
      })
    } catch (error) {
      log.error({ err: error, listId: listRecord.id }, 'Failed to synchronize manual sort order')
    }
  }))
}
