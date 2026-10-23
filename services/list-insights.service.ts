/**
 * List insights' reads (AWTD-1329): everything lib/list-insights.ts needs for
 * one list, gathered under the same rule the route answers by — anyone who can
 * view the list may read it. Kept out of the route so the access rule and the
 * query shapes live together (tests/rules/prisma-in-routes-ratchet.test.ts).
 */

import { prisma } from '@/lib/prisma'
import { getUserRoleInList, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'
import { getProjectBoardColumns } from '@/lib/project-status'
import {
  computeListInsights,
  INBOX_LANE,
  windowQueryStart,
  type InsightWindowDays,
  type ListInsights,
} from '@/lib/list-insights'

/**
 * The list's insights for `userId`, or null when the list does not exist or
 * they cannot see it — the two are deliberately indistinguishable.
 */
export async function loadListInsights(
  listId: string,
  userId: string,
  { days, timeZone, now = new Date() }: { days: InsightWindowDays; timeZone: string; now?: Date },
): Promise<ListInsights | null> {
  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      ownerId: true,
      privacy: true,
      projectId: true,
      listMembers: { select: { userId: true, role: true } },
      ...PROJECT_ACCESS_INCLUDE,
    },
  })
  // A list the caller cannot see answers exactly like one that does not exist.
  if (!list || !getUserRoleInList({ id: userId }, list as never)) return null

  const since = windowQueryStart(now, days, timeZone)

  const tasks = await prisma.task.findMany({
    where: { lists: { some: { id: listId } } },
    select: { id: true, createdAt: true, creatorId: true, assigneeId: true, completed: true, completedAt: true, repeating: true },
  })
  const taskIds = tasks.map(task => task.id)

  const [events, comments, project] = await Promise.all([
    taskIds.length
      ? prisma.taskEvent.findMany({
          where: {
            taskId: { in: taskIds },
            // Lane moves from before the window time the stays that end in it.
            OR: [{ createdAt: { gte: since } }, { kind: 'status_changed' }],
          },
          select: { taskId: true, actorId: true, kind: true, from: true, to: true, createdAt: true },
        })
      : [],
    taskIds.length
      ? prisma.comment.findMany({
          where: { taskId: { in: taskIds }, createdAt: { gte: since }, authorId: { not: null } },
          select: { taskId: true, authorId: true, createdAt: true },
        })
      : [],
    list.projectId
      ? prisma.project.findUnique({ where: { id: list.projectId }, select: { customStates: true } })
      : null,
  ])

  const userIds = new Set<string>()
  for (const task of tasks) if (task.creatorId) userIds.add(task.creatorId)
  for (const event of events) if (event.actorId) userIds.add(event.actorId)
  for (const comment of comments) if (comment.authorId) userIds.add(comment.authorId)
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true, image: true, isAIAgent: true },
      })
    : []

  // The board's lanes in column order — Inbox and each status. Done is a
  // completion, timed by create → complete, not a lane anyone waits in.
  const lanes = project
    ? getProjectBoardColumns(project.customStates)
        .filter(column => column.kind !== 'done')
        .map(column => ({ role: column.kind === 'inbox' ? INBOX_LANE : column.id, name: column.name }))
    : null

  return computeListInsights({
    now,
    days,
    timeZone,
    tasks,
    events,
    comments,
    users: users.map(user => ({ ...user, isAIAgent: user.isAIAgent ?? false })),
    lanes,
  })
}
