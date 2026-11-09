import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { describeSchedule, isDueToStart } from '@/lib/ready-queue-scope'

const log = createLogger('agent-queue')

export const PAGE_LIMIT = 500

type DueFirstMode = 'off' | 'shadow' | 'on'

const taskSelect = {
  id: true,
  identifier: true,
  title: true,
  description: true,
  priority: true,
  dueDateTime: true,
  isAllDay: true,
  createdAt: true,
  assigneeId: true,
  lists: { select: { id: true, name: true, githubRepositoryId: true } },
} satisfies Prisma.TaskSelect

type QueueTaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>

const queueOrderBy: Prisma.TaskOrderByWithRelationInput[] = [
  { priority: 'desc' },
  { createdAt: 'asc' },
]

export interface AgentQueueSelection {
  dueTasks: QueueTaskRow[]
  scheduled: Array<{ id: string; title: string; startsAt: string }>
  notDueCount: number
  truncated: boolean
}

function dueFirstMode(): DueFirstMode {
  const configured = process.env.AGENT_QUEUE_DUE_FIRST?.trim().toLowerCase()
  if (!configured || configured === 'off') return 'off'
  if (configured === 'shadow' || configured === 'on') return configured
  throw new Error('AGENT_QUEUE_DUE_FIRST must be off, shadow, or on')
}

export async function selectAgentQueueTasks(
  queueWhere: Prisma.TaskWhereInput
): Promise<AgentQueueSelection> {
  const selectionMode = dueFirstMode()
  const legacyTasks = selectionMode === 'on'
    ? []
    : await prisma.task.findMany({
        where: queueWhere,
        select: taskSelect,
        orderBy: queueOrderBy,
        take: PAGE_LIMIT,
      })
  const now = new Date()
  // Persisted DateTimes are instants; null or <= now matches isDueToStart for
  // timed and all-day tasks alike.
  const dueFirstPage = selectionMode === 'off'
    ? []
    : await prisma.task.findMany({
        where: {
          AND: [
            queueWhere,
            { OR: [{ dueDateTime: null }, { dueDateTime: { lte: now } }] },
          ],
        },
        select: taskSelect,
        orderBy: queueOrderBy,
        // The extra row distinguishes a full due page from an actually truncated one.
        take: PAGE_LIMIT + 1,
      })
  const tasks = selectionMode === 'on'
    ? dueFirstPage.slice(0, PAGE_LIMIT)
    : legacyTasks
  const dueFirstTruncated = selectionMode === 'on' && dueFirstPage.length > PAGE_LIMIT
  const withSchedule = tasks.map(task => ({
    task,
    schedule: {
      dueDateTime: task.dueDateTime?.toISOString() ?? null,
      isAllDay: task.isAllDay,
    },
  }))
  const due = withSchedule.filter(({ schedule }) => isDueToStart(schedule, now))
  const notDue = withSchedule.filter(({ schedule }) => !isDueToStart(schedule, now))
  const legacyScheduled = notDue
    .sort(
      (a, b) =>
        new Date(a.schedule.dueDateTime ?? 0).getTime() -
        new Date(b.schedule.dueDateTime ?? 0).getTime()
    )
    .map(({ task, schedule }) => ({
      id: task.id,
      title: task.title,
      startsAt: describeSchedule(schedule, now),
    }))

  let dueFirstScheduledCount = 0
  let dueFirstScheduled: AgentQueueSelection['scheduled'] = []
  if (selectionMode !== 'off') {
    const futureWhere: Prisma.TaskWhereInput = {
      AND: [queueWhere, { dueDateTime: { gt: now } }],
    }
    const [futureTasks, futureCount] = await Promise.all([
      prisma.task.findMany({
        where: futureWhere,
        select: { id: true, title: true, dueDateTime: true, isAllDay: true },
        orderBy: [
          { dueDateTime: 'asc' },
          { priority: 'desc' },
          { createdAt: 'asc' },
        ],
        take: PAGE_LIMIT,
      }),
      prisma.task.count({ where: futureWhere }),
    ])
    dueFirstScheduledCount = futureCount
    dueFirstScheduled = futureTasks.map(task => ({
      id: task.id,
      title: task.title,
      startsAt: describeSchedule(
        { dueDateTime: task.dueDateTime?.toISOString() ?? null, isAllDay: task.isAllDay },
        now
      ),
    }))

    if (selectionMode === 'shadow') {
      const legacyDueIds = due.map(({ task }) => task.id)
      const dueFirstIds = dueFirstPage
        .slice(0, PAGE_LIMIT)
        .filter(task => isDueToStart(
          { dueDateTime: task.dueDateTime?.toISOString() ?? null, isAllDay: task.isAllDay },
          now
        ))
        .map(task => task.id)
      const legacyScheduledIds = legacyScheduled.map(task => task.id)
      const dueFirstScheduledIds = dueFirstScheduled.map(task => task.id)
      const legacyIds = new Set([...legacyDueIds, ...legacyScheduledIds])
      const dueFirstIdsAll = new Set([...dueFirstIds, ...dueFirstScheduledIds])
      const differingTaskIds = [...new Set([...legacyIds, ...dueFirstIdsAll])]
        .filter(id => legacyIds.has(id) !== dueFirstIdsAll.has(id))

      log.info({
        legacyDueCount: legacyDueIds.length,
        dueFirstDueCount: dueFirstIds.length,
        legacyScheduledCount: legacyScheduledIds.length,
        dueFirstScheduledCount,
        differingTaskIds,
      }, 'agent queue due-first shadow comparison')
    }
  }

  return {
    dueTasks: due.map(({ task }) => task),
    scheduled: selectionMode === 'on' ? dueFirstScheduled : legacyScheduled,
    notDueCount: selectionMode === 'on' ? dueFirstScheduledCount : notDue.length,
    truncated: selectionMode === 'on' ? dueFirstTruncated : legacyTasks.length === PAGE_LIMIT,
  }
}
