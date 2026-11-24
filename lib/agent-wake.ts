/**
 * Opt-in event-driven wake for polling agents (AWTD-1556).
 *
 * Spec: docs/architecture/AGENT_EVENT_WAKE.md. A polling agent learns about
 * work by asking, every 30 minutes. On an enrolled board this module tells
 * the board's worker to ask NOW, at the two moments work becomes runnable:
 *
 *   1. a task enters Ready, unassigned or assigned to a polling agent (or is
 *      handed to one while already Ready);
 *   2. a person comments to a polling agent: on a task it holds, or in reply
 *      to its AGENT-HANDBACK.
 *
 * And, since AWTD-1695, when one agent's action is work for another:
 *
 *   3. a handoff files a task in Ready (1, through the create): an unassigned
 *      one wakes the agent the board's orchestration policy routes it to;
 *   4. a blocker completes and the waiting task returns to Ready, to its
 *      holder (services/task-dependency.service.ts `moveLane`);
 *   5. an agent records a question (`AGENT-HANDBACK: <asker>`) on a task
 *      another polling agent holds, and that agent's answer wakes the asker.
 *
 * An agent's own write or comment never wakes its own mailbox, and wakes an
 * agent causes are capped per task per hour (WAKE_CAP_PER_TASK_HOUR), so two
 * agents cannot wake each other forever. Every queued wake writes an
 * `agent_wake` TaskEvent, so a runaway is visible on the task.
 *
 * The wake is a hint, never an instruction. The job sends a
 * `repository_dispatch` (type `astrid-wake`) to the board's repository,
 * carrying ids and a reason but no task text, and `agent-run.yml` starts the
 * same worker its cron starts: it reads the queue and claims atomically
 * before working. So a duplicate, stale or forged wake can only start a run
 * that finds nothing, and a wake that never arrives costs latency, not work:
 * polling stays the reconciliation path.
 *
 * Off by default. Both `ASTRID_AGENT_WAKE=on` and the board's id in
 * `ASTRID_AGENT_WAKE_LISTS` are required; without them the hooks return before
 * reading anything. Coalesced: one wake per (board, agent) per
 * WAKE_COALESCE_MS, enforced by the Job table's unique dedupeKey, so a bulk
 * move of a hundred tasks is one dispatch. GitHub's concurrency group on the
 * workflow then holds at most one pending run on top of that.
 *
 * The hooks never throw: a wake is never worth failing the write that caused it.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { enqueueJob } from '@/lib/jobs/queue'
import type { AgentWakePayload } from '@/lib/jobs/kinds'
import { agentEmail, agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { getAgentExecutionMode, resolveAgentRunOwnerId } from '@/lib/ai/agent-execution-mode'
import { awaitsAgentReply, handbackMailboxOf, hasReadyStatus } from '@/lib/ready-queue-scope'
import { pendingAgentAnswer, pendingAgentHandback } from '@/lib/agent-handback'
import { recordTaskEvents, type TaskEventActorType } from '@/lib/task-events'
import { routedAgentForList } from '@/services/orchestration-policy.service'
import { SYSTEM_GENERATED_MARKER } from '@/lib/comments/post-comment-side-effects'
import { getGitHubApp, githubAppConfigured } from '@/lib/github/app'
import { ANY_AGENT_MAILBOX, WAKE_EVENT_TYPE } from '@/lib/agent-wake-event'

const log = createLogger('agent-wake')

export { ANY_AGENT_MAILBOX, WAKE_EVENT_TYPE }
/** At most one wake per (board, agent) in each window of this length. */
export const WAKE_COALESCE_MS = 30_000
/**
 * At most this many agent-caused wakes per task in any rolling hour (AWTD-1695). Two agents
 * passing one task back and forth every minute stop being woken after this; polling still reads
 * the task, at its 30-minute pace. A person's events are never capped.
 */
export const WAKE_CAP_PER_TASK_HOUR = 6
const WAKE_CAP_WINDOW_MS = 60 * 60_000
/** How many recent comments a reply check reads; a handback is never far back. */
const RECENT_COMMENTS = 20
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/

type WakeReason = AgentWakePayload['reason']

/** Who caused the event: a person's events wake as before, an agent's are guarded (AWTD-1695). */
export interface WakeActor {
  id: string | null
  type: TaskEventActorType
}

export interface WakeEnrollment {
  listId: string
  /** `owner/repo` from the enrollment entry; null means the board's connected repository. */
  repository: string | null
}

/**
 * Is this board enrolled? Entries are board ids, comma-separated, each
 * optionally `=owner/repo` to name the repository whose worker to wake.
 */
export function wakeEnrollment(listId: string | null | undefined): WakeEnrollment | null {
  if (!listId || process.env.ASTRID_AGENT_WAKE !== 'on') return null
  for (const entry of (process.env.ASTRID_AGENT_WAKE_LISTS || '').split(',')) {
    const [id, repo] = entry.split('=').map(part => part.trim())
    if (id !== listId) continue
    return { listId, repository: repo && REPOSITORY_PATTERN.test(repo) ? repo : null }
  }
  return null
}

/** One key per (board, agent, window): a second enqueue in the window is a no-op. */
export function wakeDedupeKey(listId: string, mailbox: string, at: Date): string {
  return `agent-wake:${listId}:${mailbox}:${Math.floor(at.getTime() / WAKE_COALESCE_MS)}`
}

/** Have agent-caused wakes for this task reached the hourly cap? Counted from the TaskEvent rows they wrote. */
async function wakeCapReached(taskId: string, at: Date): Promise<boolean> {
  const since = new Date(at.getTime() - WAKE_CAP_WINDOW_MS)
  const recent = await prisma.taskEvent.count({
    where: { taskId, kind: 'agent_wake', actorType: 'agent', createdAt: { gte: since } },
  })
  return recent >= WAKE_CAP_PER_TASK_HOUR
}

/**
 * Queue one wake, through the one dedupe key, and record it on the task. An agent-caused wake over
 * the task's hourly cap is dropped and recorded once (`agent_wake_capped`) per window instead.
 * A coalesced duplicate records nothing: it is the same wake.
 */
async function requestAgentWake(wake: Omit<AgentWakePayload, 'eventAt'>, actor: WakeActor | null): Promise<void> {
  const at = new Date()
  const actorType = actor?.type ?? 'system'
  const record = (kind: 'agent_wake' | 'agent_wake_capped') =>
    recordTaskEvents({
      taskId: wake.taskId,
      actorId: actor?.id ?? null,
      actorType,
      events: [{ kind, to: { listId: wake.listId, mailbox: wake.mailbox, reason: wake.reason } }],
    })

  if (actorType === 'agent' && (await wakeCapReached(wake.taskId, at))) {
    const since = new Date(at.getTime() - WAKE_CAP_WINDOW_MS)
    const noted = await prisma.taskEvent.findFirst({
      where: { taskId: wake.taskId, kind: 'agent_wake_capped', createdAt: { gte: since } },
      select: { id: true },
    })
    if (!noted) await record('agent_wake_capped')
    log.warn({ taskId: wake.taskId, mailbox: wake.mailbox, reason: wake.reason }, 'Agent wake capped for this task; polling will find it')
    return
  }

  const queued = await enqueueJob('agent-wake', { ...wake, eventAt: at.toISOString() }, {
    dedupeKey: wakeDedupeKey(wake.listId, wake.mailbox, at),
  })
  if (queued !== 'duplicate') await record('agent_wake')
}

/** The actor's own mailbox when it is an agent: its own action never wakes it. */
async function actorMailbox(actor: WakeActor | null | undefined, email?: string | null): Promise<string | null> {
  if (!actor?.id || actor.type !== 'agent') return null
  if (email !== undefined) return agentMailboxFromEmail(email)
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { email: true } })
  return agentMailboxFromEmail(user?.email)
}

interface WakeList {
  id: string
  ownerId?: string | null
  aiAgentConfiguredBy?: string | null
}

/** The mailbox to wake for this agent, or null when the server must not wake it. */
async function pollingMailbox(
  email: string | null | undefined,
  list: WakeList,
  creatorId: string | null | undefined,
): Promise<string | null> {
  const mailbox = agentMailboxFromEmail(email)
  if (!mailbox) return null
  const ownerId = resolveAgentRunOwnerId({
    aiAgentConfiguredBy: list.aiAgentConfiguredBy,
    listOwnerId: list.ownerId,
    creatorId,
  })
  // Only polling: a webhook or api agent is already told by its notifier, and
  // `off` means nothing should start it.
  return (await getAgentExecutionMode(ownerId, email)) === 'polling' ? mailbox : null
}

function enrolledLists<T extends WakeList>(lists: T[] | null | undefined): T[] {
  return (lists ?? []).filter(list => wakeEnrollment(list.id))
}

export interface WakeTaskState {
  id: string
  statusRole?: string | null
  completed?: boolean | null
  assigneeId?: string | null
}

/** Did this write make the task newly runnable? Pure, so no edit pays a query for it. */
export function readyWakeReason(
  before: WakeTaskState | null,
  after: WakeTaskState,
): 'ready' | 'assigned' | null {
  if (!hasReadyStatus(after)) return null
  if (!before || !hasReadyStatus(before)) return 'ready'
  return (before.assigneeId ?? null) !== (after.assigneeId ?? null) ? 'assigned' : null
}

/**
 * The mailbox an unassigned Ready task wakes: the agent the board's policy routes it to when it
 * names one and that agent polls (AWTD-1695), else `any`, whichever loop claims first.
 */
async function unassignedMailbox(list: WakeList, creatorId: string | null | undefined): Promise<string | null> {
  const routed = await routedAgentForList(list.id)
  if (!routed) return ANY_AGENT_MAILBOX
  return pollingMailbox(agentEmail(routed), list, creatorId)
}

/** Task create and update, and the Waiting rules' lane moves, call this after the write. Never throws. */
export async function wakeAgentsForTaskWrite(args: {
  before: WakeTaskState | null
  after: WakeTaskState
  /** Who wrote it. An agent's write never wakes that agent, and its wakes count toward the cap. */
  actor?: WakeActor | null
  /**
   * `unblocked`: a blocker completed and this task is back in Ready (AWTD-1695). The actor
   * finished a DIFFERENT task, so the holder is woken even when it is the actor: the task may
   * sit on another board, run by another worker.
   */
  reason?: 'unblocked'
}): Promise<void> {
  try {
    if (process.env.ASTRID_AGENT_WAKE !== 'on') return
    const entered = readyWakeReason(args.before, args.after)
    if (!entered) return
    const reason: WakeReason = args.reason ?? entered

    const task = await prisma.task.findUnique({
      where: { id: args.after.id },
      select: {
        id: true,
        statusRole: true,
        completed: true,
        creatorId: true,
        assigneeId: true,
        assignee: { select: { email: true, isAIAgent: true } },
        lists: { select: { id: true, ownerId: true, aiAgentConfiguredBy: true } },
      },
    })
    if (!task || !hasReadyStatus(task)) return

    const lists = enrolledLists(task.lists)
    if (lists.length === 0) return
    const self = args.reason === 'unblocked' ? null : await actorMailbox(args.actor)
    for (const list of lists) {
      const mailbox = !task.assigneeId
        ? await unassignedMailbox(list, task.creatorId)
        : task.assignee?.isAIAgent
          ? await pollingMailbox(task.assignee.email, list, task.creatorId)
          : null
      if (mailbox && mailbox !== self) {
        await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason }, args.actor ?? null)
      }
    }
  } catch (err) {
    log.warn({ err, taskId: args.after.id }, 'Could not queue an agent wake; the next poll will find the work')
  }
}

function loadCommentTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      statusRole: true,
      completed: true,
      completedAt: true,
      creatorId: true,
      assigneeId: true,
      assignee: { select: { email: true, isAIAgent: true } },
      lists: { select: { id: true, ownerId: true, aiAgentConfiguredBy: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: RECENT_COMMENTS,
        select: {
          id: true,
          authorId: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { isAIAgent: true } },
        },
      },
    },
  })
}

/**
 * An agent's comment (AWTD-1695): a recorded question wakes the agent holding the task, and an
 * answer to another agent's recorded question wakes that agent. Never the commenter itself.
 */
async function wakeForAgentComment(args: {
  comment: { id: string }
  commenter: { id: string; email?: string | null }
  task: NonNullable<Awaited<ReturnType<typeof loadCommentTask>>>
  lists: WakeList[]
}): Promise<void> {
  const { task, lists, commenter } = args
  const newestAuthored = task.comments.find(comment => comment.authorId) ?? null
  // A later comment already moved the conversation on; its own hook decides.
  if (newestAuthored?.id !== args.comment.id) return
  const actor: WakeActor = { id: commenter.id, type: 'agent' }
  const self = await actorMailbox(actor, commenter.email)

  // A question to the agent that holds the task: the queue's `attention` with that agent reading.
  if (task.assignee?.isAIAgent && task.assigneeId !== commenter.id &&
      awaitsAgentReply({ comment: newestAuthored, completedAt: task.completedAt, readerId: task.assigneeId })) {
    for (const list of lists) {
      const mailbox = await pollingMailbox(task.assignee.email, list, task.creatorId)
      if (mailbox && mailbox !== self) {
        await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason: 'agent-question' }, actor)
      }
    }
  }

  // The answer to another agent's question: wake the agent that asked.
  const question = task.comments.find(comment =>
    comment.authorId && comment.authorId !== commenter.id && comment.author?.isAIAgent && handbackMailboxOf(comment.content))
  const asker = handbackMailboxOf(question?.content)
  if (!question?.authorId || !asker || asker === self) return
  if (!pendingAgentAnswer({ comments: task.comments, agentId: question.authorId, mailbox: asker })) return
  for (const list of lists) {
    if (await pollingMailbox(agentEmail(asker), list, task.creatorId)) {
      await requestAgentWake({ listId: list.id, mailbox: asker, taskId: task.id, reason: 'agent-answer' }, actor)
    }
  }
}

/** The comment service calls this after a comment is written. Never throws. */
export async function wakeAgentsForComment(args: {
  taskId: string
  comment: { id: string; content: string }
  commenter: { id: string; isAIAgent: boolean; email?: string | null }
}): Promise<void> {
  try {
    if (process.env.ASTRID_AGENT_WAKE !== 'on') return
    // Automation output is nobody's question.
    if (args.comment.content.includes(SYSTEM_GENERATED_MARKER)) return

    if (args.commenter.isAIAgent) {
      const task = await loadCommentTask(args.taskId)
      const lists = enrolledLists(task?.lists)
      if (task && lists.length > 0) await wakeForAgentComment({ ...args, task, lists })
      return
    }

    const task = await loadCommentTask(args.taskId)
    if (!task) return
    const actor: WakeActor = { id: args.commenter.id, type: 'user' }
    const lists = enrolledLists(task.lists)
    if (lists.length === 0) return

    const newestAuthored = task.comments.find(comment => comment.authorId) ?? null

    // A reply on a task a polling agent holds: the queue's `attention` predicate.
    if (task.assignee?.isAIAgent) {
      if (!awaitsAgentReply({ comment: newestAuthored, completedAt: task.completedAt })) return
      for (const list of lists) {
        const mailbox = await pollingMailbox(task.assignee.email, list, task.creatorId)
        if (mailbox) await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason: 'reply' }, actor)
      }
      return
    }

    // A reply to an agent's explicit handback (the task sits with the person).
    const question = task.comments.find(comment => comment.author?.isAIAgent && comment.authorId)
    const mailbox = handbackMailboxOf(question?.content)
    if (!question?.authorId || !mailbox) return
    for (const list of lists) {
      if (!pendingAgentHandback({ task, agentId: question.authorId, mailbox, listId: list.id })) continue
      if (await pollingMailbox(agentEmail(mailbox), list, task.creatorId)) {
        await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason: 'handback-reply' }, actor)
      }
    }
  } catch (err) {
    log.warn({ err, taskId: args.taskId }, 'Could not queue an agent wake; the next poll will find the reply')
  }
}

/**
 * The `agent-wake` job: one repository_dispatch to the board's worker.
 *
 * Throws on a delivery failure so the queue retries and then dead-letters,
 * where someone can see it. Re-checks enrollment first: turning the switch off
 * also drops wakes already queued.
 */
export async function deliverAgentWake(payload: AgentWakePayload): Promise<void> {
  const enrollment = wakeEnrollment(payload.listId)
  if (!enrollment) return

  const repository =
    enrollment.repository ??
    (await prisma.taskList.findUnique({ where: { id: payload.listId }, select: { githubRepositoryId: true } }))
      ?.githubRepositoryId ??
    null
  if (!repository || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Board ${payload.listId} has no repository to wake; connect one or name it in ASTRID_AGENT_WAKE_LISTS`)
  }
  if (!githubAppConfigured()) throw new Error('GitHub App is not configured; cannot send an agent wake')

  const [owner, repo] = repository.split('/')
  const app = getGitHubApp()
  const { data: installation } = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo })
  const octokit = await app.getInstallationOctokit(installation.id)
  await octokit.request('POST /repos/{owner}/{repo}/dispatches', {
    owner,
    repo,
    event_type: WAKE_EVENT_TYPE,
    client_payload: {
      task_id: payload.taskId,
      mailbox: payload.mailbox,
      reason: payload.reason,
      event_at: payload.eventAt,
    },
  })
  log.info({ listId: payload.listId, mailbox: payload.mailbox, reason: payload.reason }, 'Agent wake sent')
}
