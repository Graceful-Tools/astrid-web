/**
 * What a polling harness may work right now.
 *
 * The query behind `GET /api/v1/agent-queue` and the `get_agent_queue` MCP tool.
 * It lives here rather than in the route for the reason the service-layer ratchet
 * states: this is data access with RULES attached — who may see a task, which
 * tasks count as queued — and rules in a route file are rules nothing else can
 * reuse and no test can reach without HTTP.
 *
 * The predicates themselves come from lib/ready-queue-scope.ts, shared with
 * scripts/ready-tasks.ts. A second copy of "may a loop take this?" would drift,
 * and the drift would be silent: a wrong answer here looks exactly like a quiet
 * day on the board.
 */

import { prisma } from '@/lib/prisma'
import { getTaskUrl } from '@/lib/base-url'
import { READY_STATUS_ROLE } from '@/lib/task-status'
import { agentEmail, agentMailboxFromEmail, isBrandAgentEmail } from '@/lib/brand/agent-emails'
import { describeSchedule, isDueToStart } from '@/lib/ready-queue-scope'
import { getAgentExecutionMode, pollableMailboxes } from '@/lib/ai/agent-execution-mode'

/** One page is the point: a truncated queue looks exactly like a short one. */
const PAGE_LIMIT = 500

export interface AgentQueueTask {
  id: string
  identifier: string | null
  title: string
  description: string | null
  priority: number | null
  dueDateTime: string | null
  listId: string | null
  listName: string | null
  githubRepositoryId: string | null
  url: string
}

export interface AgentQueueResult {
  agent: { mailbox: string; email: string; id: string | null; name?: string | null }
  mode: string
  empty: boolean
  queue: AgentQueueTask[]
  held: {
    notDueCount: number
    scheduled: Array<{ id: string; title: string; startsAt: string }>
  }
  truncated: boolean
}

/**
 * Thrown for a caller mistake — an absent or unrecognised agent identity — so the
 * route can answer 400 without the queue module knowing what an HTTP status is.
 */
export class UnknownAgentError extends Error {
  readonly hint: string

  constructor(message: string) {
    super(message)
    this.name = 'UnknownAgentError'
    this.hint = `Expected one of: ${pollableMailboxes().join(', ')}`
  }
}

export interface AgentQueueOptions {
  /** The agent identity the harness runs as — a mailbox or a full address. */
  agent: string | null | undefined
  /** Whose visibility scopes the queue: the person driving the harness. */
  userId: string
  /** Optional board scope, for accounts whose boards are worked by different harnesses. */
  listId?: string | null
}

export async function buildAgentQueue({
  agent,
  userId,
  listId = null,
}: AgentQueueOptions): Promise<AgentQueueResult> {
  // No default identity, ever. A loop that guesses which agent it is claims
  // another harness's work — the one failure here that costs duplicated effort
  // rather than an empty answer.
  const requested = agent?.trim()
  if (!requested) {
    throw new UnknownAgentError('agent is required')
  }

  const email = requested.includes('@') ? requested.toLowerCase() : agentEmail(requested)
  const mailbox = agentMailboxFromEmail(email)

  // A typo has to fail LOUDLY. `claud@` is a perfectly well-shaped agent address
  // that no row will ever match, so accepting it would answer "nothing queued"
  // on every run, forever, with nothing saying why — the exact silent failure a
  // scheduled loop cannot debug.
  if (!mailbox || !isBrandAgentEmail(email) || !pollableMailboxes().includes(mailbox)) {
    throw new UnknownAgentError(`Unknown agent "${requested}"`)
  }

  const mode = await getAgentExecutionMode(userId, email)

  const agentUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, isAIAgent: true },
  })

  // An agent identity that does not exist yet is an empty queue, not an error:
  // the row is created the first time someone assigns work to it.
  if (!agentUser?.isAIAgent) {
    return {
      agent: { mailbox, email, id: null },
      mode,
      empty: true,
      queue: [],
      held: { notDueCount: 0, scheduled: [] },
      truncated: false,
    }
  }

  // Visibility is the CALLER's, not the agent's: the queue may only contain tasks
  // the person driving the harness could already read.
  const visibleToCaller = {
    OR: [
      { ownerId: userId },
      { listMembers: { some: { userId } } },
      { privacy: 'PUBLIC' as const },
    ],
  }

  const tasks = await prisma.task.findMany({
    where: {
      // Assignment is the handshake, and it is REQUIRED here — deliberately
      // stricter than the local /fixall script's isClaimableByAgent, which also
      // takes unassigned tasks. That is safe on one person's own board and
      // unsafe on a shared list, where an unassigned Ready task is somebody's
      // untriaged note rather than an invitation.
      assigneeId: agentUser.id,
      completed: false,
      // Ready is a FIELD on the task (AWTD-562), not membership in a list.
      statusRole: READY_STATUS_ROLE,
      lists: { some: listId ? { id: listId, ...visibleToCaller } : visibleToCaller },
    },
    select: {
      id: true,
      identifier: true,
      title: true,
      description: true,
      priority: true,
      dueDateTime: true,
      isAllDay: true,
      createdAt: true,
      lists: { select: { id: true, name: true, githubRepositoryId: true } },
    },
    // Priority high → low, then oldest first — the order a loop works them in.
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: PAGE_LIMIT,
  })

  const now = new Date()
  const withSchedule = tasks.map(task => ({
    task,
    schedule: {
      dueDateTime: task.dueDateTime?.toISOString() ?? null,
      isAllDay: task.isAllDay,
    },
  }))

  // A task with a date is not work for today. Recurrence needs nothing else:
  // completing a repeating task rolls it to its next occurrence, and this rule
  // then holds it until that moment arrives.
  const due = withSchedule.filter(({ schedule }) => isDueToStart(schedule, now))
  const notDue = withSchedule.filter(({ schedule }) => !isDueToStart(schedule, now))

  return {
    agent: { mailbox, email, id: agentUser.id, name: agentUser.name },
    mode,
    // An explicit flag, so a loop can stop without interpreting an array.
    empty: due.length === 0,
    queue: due.map(({ task }) => ({
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDateTime: task.dueDateTime?.toISOString() ?? null,
      listId: task.lists[0]?.id ?? null,
      listName: task.lists[0]?.name ?? null,
      githubRepositoryId: task.lists.find(l => l.githubRepositoryId)?.githubRepositoryId ?? null,
      url: getTaskUrl(task.id),
    })),
    // A queue waiting on the clock must not look like an idle one — say WHEN, so
    // a recurring task that is simply not due yet is visibly different from one
    // nobody has queued.
    held: {
      notDueCount: notDue.length,
      scheduled: notDue
        .sort(
          (a, b) =>
            new Date(a.schedule.dueDateTime ?? 0).getTime() -
            new Date(b.schedule.dueDateTime ?? 0).getTime()
        )
        .map(({ task, schedule }) => ({
          id: task.id,
          title: task.title,
          startsAt: describeSchedule(schedule, now),
        })),
    },
    // A truncated page would hide queued work behind a backlog and report a clean
    // run, so say it rather than working a silent subset.
    truncated: tasks.length === PAGE_LIMIT,
  }
}
