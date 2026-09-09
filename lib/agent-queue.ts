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
    /** Assigned to this agent and visible to the caller, but not Ready. */
    notReadyCount: number
    scheduled: Array<{ id: string; title: string; startsAt: string }>
  }
  truncated: boolean
  /**
   * Why the queue is empty, when it is. Absent whenever there is work: a loop
   * with something to do needs no explanation (AWTD-845).
   */
  hint?: string
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
  /**
   * Must a task carry `statusRole: "ready"` to queue? Defaults to TRUE — the rule
   * every existing loop already runs under.
   *
   * `false` relaxes it by exactly one notch, for people who do not use the board
   * (AWTD-871): a task with NO status queues too. A status that IS set still means
   * what it says, so Waiting, Doing and a project's custom states stay out under
   * either setting. `isQueueableStatusRole` owns that rule and says why.
   */
  requireReady?: boolean
}

/**
 * The status half of the queue's WHERE clause.
 *
 * `isQueueableStatusRole` is the rule; this is the same rule expressed as a query,
 * because the queue filters in the database rather than in memory. The two are kept
 * next to each other on purpose — a Prisma filter that drifts from the predicate is
 * the silent kind of wrong, since a queue that matches too little reads exactly like
 * a quiet day.
 *
 * NULL has to be named explicitly. `{ in: ["ready"] }` does not match NULL in SQL,
 * and NULL is the entire population this flag exists for.
 */
function queuedStatusFilter(requireReady: boolean) {
  if (requireReady) return { statusRole: READY_STATUS_ROLE }
  return { OR: [{ statusRole: READY_STATUS_ROLE }, { statusRole: null }] }
}

/**
 * The complement: assigned to this agent but held OUT by its status. Only asked
 * when the queue came back empty, to say which condition was the unmet one.
 *
 * It has to be the exact negation of `queuedStatusFilter`, or the explanation
 * describes a different rule from the one that produced the emptiness:
 *
 *   - requiring Ready, the holds are every other status AND the unstatused. The
 *     reported failure (AWTD-845) was `statusRole: NULL` on every task, so that
 *     case is named rather than left to how NOT treats NULL — a filter that
 *     quietly skipped the null rows would answer "nothing is assigned" for the
 *     one situation this count exists to explain.
 *   - not requiring Ready, an unstatused task is QUEUED, so counting it as held
 *     would report a hold that is not happening and send the caller to fix a
 *     status that is already fine. What is left is work somebody deliberately
 *     parked: Waiting, Doing, or a project's own state.
 */
function heldByStatusFilter(requireReady: boolean) {
  if (requireReady) {
    return { OR: [{ statusRole: null }, { statusRole: { not: READY_STATUS_ROLE } }] }
  }
  return { statusRole: { not: null } }
}

export async function buildAgentQueue({
  agent,
  userId,
  listId = null,
  requireReady = true,
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
      held: { notDueCount: 0, notReadyCount: 0, scheduled: [] },
      truncated: false,
      hint: nothingAssignedHint(mailbox),
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

  // One shape, used by the queue and by the count that explains an empty one. A
  // count drawn more widely would report work the caller cannot see.
  const listScope = { some: listId ? { id: listId, ...visibleToCaller } : visibleToCaller }

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
      ...queuedStatusFilter(requireReady),
      lists: listScope,
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

  const scheduled = notDue
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

  const empty = due.length === 0

  // Asked only when the answer is empty. A loop with work to do must not pay a
  // second query to explain an emptiness it does not have (AWTD-845).
  const notReadyCount = empty
    ? await prisma.task.count({
        where: {
          assigneeId: agentUser.id,
          completed: false,
          ...heldByStatusFilter(requireReady),
          lists: listScope,
        },
      })
    : 0

  return {
    agent: { mailbox, email, id: agentUser.id, name: agentUser.name },
    mode,
    // An explicit flag, so a loop can stop without interpreting an array.
    empty,
    hint: empty ? emptyQueueHint(mailbox, notReadyCount, scheduled, requireReady) : undefined,
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
      notReadyCount,
      scheduled,
    },
    // A truncated page would hide queued work behind a backlog and report a clean
    // run, so say it rather than working a silent subset.
    truncated: tasks.length === PAGE_LIMIT,
  }
}

/**
 * Why an empty queue is empty.
 *
 * `get_agent_queue` requires TWO conditions — assigned to this agent, and Ready
 * — and until AWTD-845 a caller who met only the first got `empty: true` on
 * every poll with nothing naming the one they had missed. Following the
 * published setup exactly produced precisely that: tasks assigned to `claude`,
 * every one of them `statusRole: null`, and a queue that reads like a quiet day.
 *
 * The holds are reported in the order that tells the caller the most. A queue
 * waiting on the CLOCK proves the setup is already correct, so it is named
 * first and never blamed on status — sending someone to change a status that is
 * right is worse than saying nothing.
 */
function emptyQueueHint(
  mailbox: string,
  notReadyCount: number,
  scheduled: Array<{ startsAt: string }>,
  requireReady: boolean
): string {
  if (scheduled.length > 0) {
    const waiting = `${scheduled.length} task(s) are queued for ${mailbox} but not due to start yet — the earliest begins ${scheduled[0].startsAt}.`
    return notReadyCount > 0
      ? `${waiting} ${notReadyHint(mailbox, notReadyCount, requireReady)}`
      : waiting
  }
  if (notReadyCount > 0) return notReadyHint(mailbox, notReadyCount, requireReady)
  return nothingAssignedHint(mailbox)
}

/**
 * The status hold, explained differently depending on which rule produced it.
 *
 * Under the default rule there are now TWO cures, and until AWTD-871 only one was
 * ever offered: "set Ready". For someone who does not use the board that is advice
 * to adopt a feature they have declined, so the second cure is named beside it.
 *
 * A caller who has ALREADY passed `requireReady: false` must not be told to set
 * Ready or to pass the flag they just passed — everything still held is work they
 * deliberately parked, so say that instead.
 */
function notReadyHint(mailbox: string, count: number, requireReady: boolean): string {
  if (!requireReady) {
    return `${count} task(s) are assigned to ${mailbox} but sit in a status the queue never takes — Waiting, Doing, or a project's own state. Those are deliberately parked; move one to Ready, or clear its status, to queue it.`
  }
  return `${count} task(s) are assigned to ${mailbox} but are not in Ready status, so the queue cannot see them. Set Ready from the task's … menu → Status, by dragging the card into the Ready column, or with update_task { statusRole: "ready" }. If you do not use the board at all, ask for the queue with requireReady: false instead and unstatused tasks will queue too.`
}

function nothingAssignedHint(mailbox: string): string {
  return `No incomplete tasks are assigned to ${mailbox}. A task is queued only when it is BOTH assigned to ${mailbox} and in Ready status.`
}
