/**
 * Which lists may a user-search request actually search?
 *
 * `GET /api/users/search` and `GET /api/v1/users/search` both accepted
 * `listIds` and `taskId` straight from the query string and returned the
 * matching lists' members — **including their email addresses** — without ever
 * checking that the caller had anything to do with those lists.
 *
 * So any authenticated caller holding a list id (a former member, anyone who
 * has seen a share link, anyone who guessed) could enumerate that list's
 * current members and their emails. Both implementations had it, so comparing
 * the two would never have revealed it. (Task e0613ae5.)
 *
 * This narrows the requested scope to lists the caller can genuinely see:
 * lists they own, and lists they are a member of. Anything else is silently
 * dropped rather than rejected — a search is not the place to tell a caller
 * which list ids are real.
 */

import { prisma } from '@/lib/prisma'

export async function resolveSearchListIds(args: {
  userId: string
  listIds?: string[] | null
  taskId?: string | null
}): Promise<string[]> {
  const { userId, listIds, taskId } = args

  // A taskId is only a way of naming lists; the caller must still be able to
  // see the task, or its lists are none of their business.
  let requested: string[] = listIds ?? []
  if (taskId) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { creatorId: userId },
          { assigneeId: userId },
          {
            lists: {
              some: {
                OR: [
                  { ownerId: userId },
                  { listMembers: { some: { userId } } },
                  { privacy: 'PUBLIC' },
                ],
              },
            },
          },
        ],
      },
      select: { lists: { select: { id: true } } },
    })
    requested = task ? task.lists.map(l => l.id) : []
  }

  if (requested.length === 0) return []

  // Keep only the requested lists the caller actually belongs to. Note that
  // PUBLIC is deliberately NOT a qualifier here: being able to read a public
  // list does not entitle you to its members' email addresses.
  const visible = await prisma.taskList.findMany({
    where: {
      id: { in: requested },
      OR: [
        { ownerId: userId },
        { listMembers: { some: { userId } } },
      ],
    },
    select: { id: true },
  })

  return visible.map(l => l.id)
}
