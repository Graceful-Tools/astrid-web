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
import { awaitsAgentReply, hasReadyStatus } from '@/lib/ready-queue-scope'
import { pendingAgentHandback } from '@/lib/agent-handback'
import { SYSTEM_GENERATED_MARKER } from '@/lib/comments/post-comment-side-effects'
import { getGitHubApp, githubAppConfigured } from '@/lib/github/app'

const log = createLogger('agent-wake')

/** The repository_dispatch type agent-run.yml listens for. */
export const WAKE_EVENT_TYPE = 'astrid-wake'
/** The mailbox of a wake for an unassigned Ready task: any loop may claim it. */
export const ANY_AGENT_MAILBOX = 'any'
/** At most one wake per (board, agent) in each window of this length. */
export const WAKE_COALESCE_MS = 30_000
/** How many recent comments a reply check reads; a handback is never far back. */
const RECENT_COMMENTS = 20
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/
const HANDBACK_LINE = /^\s*AGENT-HANDBACK:\s*(\S+)\s*$/m

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

async function requestAgentWake(wake: Omit<AgentWakePayload, 'eventAt'>): Promise<void> {
  const at = new Date()
  await enqueueJob('agent-wake', { ...wake, eventAt: at.toISOString() }, {
    dedupeKey: wakeDedupeKey(wake.listId, wake.mailbox, at),
  })
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

/** Task create and update call this after the write. Never throws. */
export async function wakeAgentsForTaskWrite(args: {
  before: WakeTaskState | null
  after: WakeTaskState
}): Promise<void> {
  try {
    if (process.env.ASTRID_AGENT_WAKE !== 'on') return
    const reason = readyWakeReason(args.before, args.after)
    if (!reason) return

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

    for (const list of enrolledLists(task.lists)) {
      const mailbox = !task.assigneeId
        ? ANY_AGENT_MAILBOX
        : task.assignee?.isAIAgent
          ? await pollingMailbox(task.assignee.email, list, task.creatorId)
          : null
      if (mailbox) await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason })
    }
  } catch (err) {
    log.warn({ err, taskId: args.after.id }, 'Could not queue an agent wake; the next poll will find the work')
  }
}

/** The comment service calls this after a comment is written. Never throws. */
export async function wakeAgentsForComment(args: {
  taskId: string
  comment: { id: string; content: string }
  commenter: { id: string; isAIAgent: boolean }
}): Promise<void> {
  try {
    if (process.env.ASTRID_AGENT_WAKE !== 'on') return
    // An agent's own comment is the answer, and automation output is nobody's question.
    if (args.commenter.isAIAgent || args.comment.content.includes(SYSTEM_GENERATED_MARKER)) return

    const task = await prisma.task.findUnique({
      where: { id: args.taskId },
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
    if (!task) return
    const lists = enrolledLists(task.lists)
    if (lists.length === 0) return

    const newestAuthored = task.comments.find(comment => comment.authorId) ?? null

    // A reply on a task a polling agent holds: the queue's `attention` predicate.
    if (task.assignee?.isAIAgent) {
      if (!awaitsAgentReply({ comment: newestAuthored, completedAt: task.completedAt })) return
      for (const list of lists) {
        const mailbox = await pollingMailbox(task.assignee.email, list, task.creatorId)
        if (mailbox) await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason: 'reply' })
      }
      return
    }

    // A reply to an agent's explicit handback (the task sits with the person).
    const question = task.comments.find(comment => comment.author?.isAIAgent && comment.authorId)
    const mailbox = question?.content.match(HANDBACK_LINE)?.[1]?.toLowerCase()
    if (!question?.authorId || !mailbox) return
    for (const list of lists) {
      if (!pendingAgentHandback({ task, agentId: question.authorId, mailbox, listId: list.id })) continue
      if (await pollingMailbox(agentEmail(mailbox), list, task.creatorId)) {
        await requestAgentWake({ listId: list.id, mailbox, taskId: task.id, reason: 'handback-reply' })
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
