/**
 * List insights API v1 (AWTD-1329)
 *
 * GET /api/v1/lists/:id/insights?days=30&tz=America/Los_Angeles
 *
 * New and completed tasks per day, the median time from create to complete,
 * the median stay in each board lane (boards only), and the top contributors —
 * over the last `days` (7, 30 or 90; default 30) calendar days in `tz` (an IANA
 * zone; default UTC). The response is `{ insights: ListInsights }`, the shape
 * in lib/list-insights.ts, and it is the contract every platform renders: the
 * history it is computed from lives only on the server.
 *
 * Anyone who can view the list may read it.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getUserRoleInList, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'
import { getProjectBoardColumns } from '@/lib/project-status'
import {
  computeListInsights,
  DEFAULT_INSIGHT_WINDOW_DAYS,
  INBOX_LANE,
  INSIGHT_WINDOW_DAYS,
  isValidTimeZone,
  windowQueryStart,
  type InsightWindowDays,
} from '@/lib/list-insights'

type RouteContext = { params: Promise<{ id: string }> }

function parseDays(value: string | null): InsightWindowDays | null {
  if (value === null) return DEFAULT_INSIGHT_WINDOW_DAYS
  const days = Number(value)
  return (INSIGHT_WINDOW_DAYS as readonly number[]).includes(days) ? (days as InsightWindowDays) : null
}

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.insights' },
  async (req, auth, { params }) => {
    const { id } = await params
    const url = new URL(req.url)

    const days = parseDays(url.searchParams.get('days'))
    if (days === null) {
      return NextResponse.json(
        { error: `days must be one of ${INSIGHT_WINDOW_DAYS.join(', ')}` },
        { status: 400 },
      )
    }
    const timeZone = url.searchParams.get('tz') || 'UTC'
    if (!isValidTimeZone(timeZone)) {
      return NextResponse.json({ error: `Unknown time zone: ${timeZone}` }, { status: 400 })
    }

    const list = await prisma.taskList.findUnique({
      where: { id },
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
    if (!list || !getUserRoleInList({ id: auth.userId }, list as never)) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const now = new Date()
    const since = windowQueryStart(now, days, timeZone)

    const tasks = await prisma.task.findMany({
      where: { lists: { some: { id } } },
      select: { id: true, createdAt: true, creatorId: true, completed: true, completedAt: true, repeating: true },
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
            select: { authorId: true, createdAt: true },
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

    const insights = computeListInsights({
      now,
      days,
      timeZone,
      tasks,
      events,
      comments,
      users: users.map(user => ({ ...user, isAIAgent: user.isAIAgent ?? false })),
      lanes,
    })

    return NextResponse.json({ insights })
  },
)
