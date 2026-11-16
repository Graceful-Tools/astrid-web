/**
 * Agent presence per board (AWTD-1697).
 *
 * Records when an agent last asked a board's queue and last renewed a claim
 * there, from calls the server already receives — no new call for a harness to
 * make. Read by the list's agent roster (GET /api/v1/lists/:id/agents) and by
 * the five-minute waiting-settle cron, which tells the list owner once when an
 * agent has gone quiet. The rules are in lib/agent-presence.ts.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { listReadByIdWhere } from '@/lib/list-permissions'
import { persistNotifications } from '@/lib/notification-store'
import { DOING_STATUS_ROLE, READY_STATUS_ROLE } from '@/lib/task-status'
import {
  AGENT_EXPECTED_INTERVAL_SECONDS,
  agentPresenceState,
  lastSeenAt,
  readyWaitFlag,
  type AgentPresenceState,
  type ReadyWaitFlag,
} from '@/lib/agent-presence'

const log = createLogger('agent-presence')

async function touch(
  listIds: string[],
  agentId: string,
  field: 'lastQueueCheckAt' | 'lastHeartbeatAt',
  now: Date,
): Promise<void> {
  await Promise.all([...new Set(listIds)].map(listId => prisma.agentListPresence.upsert({
    where: { listId_agentId: { listId, agentId } },
    create: { listId, agentId, [field]: now },
    // Seen again: the next silence is a new one and tells the owner again.
    update: { [field]: now, quietNotifiedAt: null },
  })))
}

/**
 * A queue check by `agentId` on these boards. Only boards the caller can read
 * are recorded, so a credential cannot mark presence on a stranger's board.
 * Never throws: presence is a signal, and must not fail the call it rides on.
 */
export async function recordAgentQueueCheck(input: {
  agentId: string
  userId: string
  listIds: string[]
  now?: Date
}): Promise<void> {
  try {
    if (input.listIds.length === 0) return
    const visible = await prisma.taskList.findMany({
      where: { id: { in: input.listIds }, ...listReadByIdWhere(input.userId) },
      select: { id: true },
    })
    await touch(visible.map(list => list.id), input.agentId, 'lastQueueCheckAt', input.now ?? new Date())
  } catch (err) {
    log.error({ err }, 'recording an agent queue check FAILED')
  }
}

/** A claim or heartbeat by `agentId` on `taskId`: presence on each board the task is in. */
export async function recordAgentHeartbeat(input: {
  agentId: string
  taskId: string
  now?: Date
}): Promise<void> {
  try {
    const lists = await prisma.taskList.findMany({
      where: { tasks: { some: { id: input.taskId } } },
      select: { id: true },
    })
    await touch(lists.map(list => list.id), input.agentId, 'lastHeartbeatAt', input.now ?? new Date())
  } catch (err) {
    log.error({ err }, 'recording an agent heartbeat FAILED')
  }
}

export interface ListAgentPresence {
  agent: { id: string; name: string | null; email: string; image: string | null }
  lastQueueCheckAt: string | null
  lastHeartbeatAt: string | null
  lastSeenAt: string | null
  state: AgentPresenceState
  heldTask: { id: string; identifier: string | null; title: string } | null
}

export interface ListAgentRoster {
  expectedIntervalSeconds: number
  agents: ListAgentPresence[]
  /** Ready tasks that have waited longer than the pickup time, with the reason when known. */
  readyWait: (Omit<ReadyWaitFlag, 'oldestSince'> & { oldestSince: string }) | null
}

/** The roster of a board the caller can read; null when they cannot see it (or it does not exist). */
export async function loadListAgentRoster(listId: string, userId: string, now = new Date()): Promise<ListAgentRoster | null> {
  const visible = await prisma.taskList.findFirst({
    where: { id: listId, ...listReadByIdWhere(userId) },
    select: { id: true },
  })
  if (!visible) return null
  const [rows, ready] = await Promise.all([
    prisma.agentListPresence.findMany({
      where: { listId },
      include: { agent: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: { lists: { some: { id: listId } }, statusRole: READY_STATUS_ROLE, completed: false },
      select: { updatedAt: true },
    }),
  ])
  const doing = rows.length === 0 ? [] : await prisma.task.findMany({
    where: {
      lists: { some: { id: listId } },
      statusRole: DOING_STATUS_ROLE,
      completed: false,
      assigneeId: { in: rows.map(row => row.agentId) },
    },
    select: { id: true, identifier: true, title: true, assigneeId: true },
    orderBy: { updatedAt: 'desc' },
  })

  const agents = rows.map((row): ListAgentPresence => {
    const times = { lastQueueCheckAt: row.lastQueueCheckAt, lastHeartbeatAt: row.lastHeartbeatAt }
    const held = doing.find(task => task.assigneeId === row.agentId)
    return {
      agent: row.agent,
      lastQueueCheckAt: row.lastQueueCheckAt?.toISOString() ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      lastSeenAt: lastSeenAt(times)?.toISOString() ?? null,
      state: agentPresenceState(times, now),
      heldTask: held ? { id: held.id, identifier: held.identifier, title: held.title } : null,
    }
  })

  const flag = readyWaitFlag({
    readySince: ready.map(task => task.updatedAt),
    agents: rows.map(row => ({ times: { lastQueueCheckAt: row.lastQueueCheckAt, lastHeartbeatAt: row.lastHeartbeatAt } })),
  }, now)

  return {
    expectedIntervalSeconds: AGENT_EXPECTED_INTERVAL_SECONDS,
    agents,
    readyWait: flag ? { ...flag, oldestSince: flag.oldestSince.toISOString() } : null,
  }
}

export interface QuietAgentReport {
  scanned: number
  notified: number
}

/**
 * Tell each list owner, once, about an agent that has gone quiet. The mark is
 * claimed with a conditional write before the notification is made, so two
 * overlapping cron ticks cannot both notify; the next sign of life clears it.
 */
export async function notifyQuietAgents(now = new Date()): Promise<QuietAgentReport> {
  const quietBefore = new Date(now.getTime() - AGENT_EXPECTED_INTERVAL_SECONDS * 2 * 1000)
  const candidates = await prisma.agentListPresence.findMany({
    where: {
      quietNotifiedAt: null,
      OR: [{ lastQueueCheckAt: { lte: quietBefore } }, { lastHeartbeatAt: { lte: quietBefore } }],
    },
    include: { list: { select: { ownerId: true } } },
    take: 200,
  })

  const report: QuietAgentReport = { scanned: candidates.length, notified: 0 }
  for (const row of candidates) {
    const times = { lastQueueCheckAt: row.lastQueueCheckAt, lastHeartbeatAt: row.lastHeartbeatAt }
    // One signal can be old while the other is fresh.
    if (agentPresenceState(times, now) !== 'quiet') continue
    const claimed = await prisma.agentListPresence.updateMany({
      where: { id: row.id, quietNotifiedAt: null },
      data: { quietNotifiedAt: now },
    })
    if (claimed.count !== 1) continue
    const held = await prisma.task.findFirst({
      where: {
        lists: { some: { id: row.listId } },
        statusRole: DOING_STATUS_ROLE,
        completed: false,
        assigneeId: row.agentId,
      },
      select: { id: true },
    })
    await persistNotifications({
      targets: [{ userId: row.list.ownerId, kind: 'agent_quiet' }],
      context: { taskId: held?.id ?? null, actorId: row.agentId },
    })
    report.notified += 1
  }
  return report
}
