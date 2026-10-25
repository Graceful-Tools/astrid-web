/**
 * List insights' reads (AWTD-1329): everything lib/list-insights.ts needs for
 * one list, gathered under the same rule the route answers by — anyone who can
 * view the list may read it. Kept out of the route so the access rule and the
 * query shapes live together (tests/rules/prisma-in-routes-ratchet.test.ts).
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { getUserRoleInList, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'
import { getProjectBoardColumns } from '@/lib/project-status'
import {
  computeListInsights,
  dayKey,
  INBOX_LANE,
  LANE_HISTORY_START,
  LANE_MOVE_KINDS,
  windowQueryStart,
  type InsightWindowDays,
  type ListInsights,
} from '@/lib/list-insights'

/**
 * How long a computed answer is served from Redis. The numbers are daily
 * trends and medians over 7–90 days, so five minutes of lag is invisible, and
 * a TTL needs no invalidation hook on every task, event and comment write —
 * the kind of hook whose blast radius has bitten this codebase (AWTD-1320).
 */
export const LIST_INSIGHTS_CACHE_TTL_SECONDS = 300

/**
 * One entry per list, window and zone — insights do not depend on who asks.
 * The viewer's day is in the key so a cached answer never outlives its
 * window's last day.
 */
export function listInsightsCacheKey(listId: string, days: InsightWindowDays, timeZone: string, now: Date): string {
  return `insights:list:${listId}:${days}:${timeZone}:${dayKey(now, timeZone)}`
}

/**
 * The list's insights for `userId`, or null when the list does not exist or
 * they cannot see it — the two are deliberately indistinguishable. The access
 * check runs on every call; only the computed answer is cached.
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

  return RedisCache.getOrSet(
    listInsightsCacheKey(listId, days, timeZone, now),
    () => computeFromHistory(listId, list.projectId, { days, timeZone, now }),
    LIST_INSIGHTS_CACHE_TTL_SECONDS,
  )
}

async function computeFromHistory(
  listId: string,
  projectId: string | null,
  { days, timeZone, now }: { days: InsightWindowDays; timeZone: string; now: Date },
): Promise<ListInsights> {
  const since = windowQueryStart(now, days, timeZone)
  const laneMoveKinds = [...LANE_MOVE_KINDS]

  const tasks = await prisma.task.findMany({
    where: {
      lists: { some: { id: listId } },
      // Only the tasks this window can say something about (AWTD-1367). Loading the whole
      // list meant 1,386 task rows to answer a question about 370 of them on the Astrid Web
      // board, and 132 rows to answer one about none of them on a quiet list — and the id
      // set goes on to bound the event and comment queries below, so it multiplies.
      //
      // Every branch is load-bearing. computeListInsights filters events and comments by
      // `taskIds.has(...)`, so a task missing from this set loses its edit and comment
      // credits as well as its own created/completed counts.
      OR: [
        { createdAt: { gte: since } },
        { completedAt: { gte: since } },
        { events: { some: { createdAt: { gte: since } } } },
        // A lane stay is timed when it ENDS in the window, from the move that opened it —
        // and that move can be arbitrarily old, so this branch carries no date bound.
        { events: { some: { kind: { in: laneMoveKinds } } } },
        { comments: { some: { createdAt: { gte: since } } } },
      ],
    },
    select: { id: true, createdAt: true, creatorId: true, assigneeId: true, completed: true, completedAt: true, repeating: true, statusRole: true, statusRoleBeforeDone: true },
  })
  const taskIds = tasks.map(task => task.id)

  const [events, comments, project] = await Promise.all([
    taskIds.length
      ? prisma.taskEvent.findMany({
          where: {
            taskId: { in: taskIds },
            // Lane history from before the window times the stays that end in it: a move, or the
            // completion that tells laneDurations a card born after LANE_HISTORY_START left its birth lane.
            //
            // The lane branch deliberately has NO date bound, and in particular not
            // LANE_HISTORY_START (AWTD-1367): production holds 14 `unblocked` events from
            // 2026-10-11 and `status_changed` events from 2026-10-20, all older than that
            // constant, so bounding by it would silently stop timing real stays. It is bounded
            // where it counts instead — by `kind`, against @@index([kind, createdAt]), over 98
            // rows repo-wide.
            OR: [
              { createdAt: { gte: since } },
              { kind: { in: laneMoveKinds } },
              { kind: { in: ['completed', 'closed', 'reopened'] }, createdAt: { gte: LANE_HISTORY_START } },
            ],
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
    projectId
      ? prisma.project.findUnique({ where: { id: projectId }, select: { customStates: true } })
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
