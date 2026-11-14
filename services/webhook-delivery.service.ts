/**
 * Webhook delivery policy settings and delivery notices (AWTD-1561).
 *
 * A notice is a comment SIGNED BY THE AGENT whose delivery failed — the same
 * attribution fixall parking and agent replies use — because iOS and the Mac
 * hide authorless comments. It goes through the comment service
 * (services/post-comment-as.ts), so it is broadcast and notified like any
 * comment, and it @mentions the run's owner, who may be neither the creator
 * nor a past commenter. It carries the system-generated marker (never wakes an
 * agent) and the delivery-notice marker (left out of the agent's history).
 *
 * Strict parking moves the task to Waiting through the task service, so the
 * Waiting rules (lib/waiting-rules.ts) see a condition in the same write: a
 * recheck date 24h ahead unless the task already has a future one, and the
 * agent stays assigned.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { WAITING_STATUS_ROLE } from '@/lib/task-status'
import { getNotificationTranslator, intlTag, renderLocale } from '@/lib/i18n/user-locale'
import type { Locale } from '@/lib/i18n/config'
import { SYSTEM_GENERATED_MARKER } from '@/lib/comments/post-comment-side-effects'
import {
  agentPolicyBindings,
  parseWebhookDeliverySettings,
  resolveWebhookDeliveryPolicy,
  WEBHOOK_DELIVERY_NOTICE_MARKER,
  type WebhookDeliveryPolicy,
} from '@/lib/webhooks/delivery-policy'

const log = createLogger('services.webhook-delivery')

export const STRICT_PARK_RECHECK_MS = 24 * 60 * 60 * 1000

export async function getWebhookDeliverySettings(userId: string) {
  const user = await defaultPrisma.user.findUnique({ where: { id: userId }, select: { mcpSettings: true } })
  const settings = parseWebhookDeliverySettings(user?.mcpSettings)
  return { policy: resolveWebhookDeliveryPolicy(settings), agents: agentPolicyBindings(settings) }
}

/** Returns null when the settings changed underneath (the caller answers 409). */
export async function setWebhookDeliverySettings(userId: string, policy: WebhookDeliveryPolicy, agent?: string) {
  const user = await defaultPrisma.user.findUnique({ where: { id: userId }, select: { mcpSettings: true } })
  // A write never replaces a blob it cannot read: that would drop saved API keys.
  const settings = parseWebhookDeliverySettings(user?.mcpSettings, () => {
    throw new Error('Stored settings are unreadable; refusing to overwrite them')
  })
  const next = agent
    ? { ...settings, agentWebhookDeliveryPolicies: { ...agentPolicyBindings(settings), [agent]: policy } }
    : { ...settings, webhookDeliveryPolicy: policy }
  const saved = await defaultPrisma.user.updateMany({
    where: { id: userId, mcpSettings: user?.mcpSettings ?? null },
    data: { mcpSettings: JSON.stringify(next) },
  })
  if (saved.count === 0) return null
  return { policy: resolveWebhookDeliveryPolicy(next), agents: agentPolicyBindings(next) }
}

export interface DeliveryNoticeInput {
  taskId: string
  /** The agent USER whose delivery failed; it signs the notice. */
  agentUserId: string | null | undefined
  /** The run's owner (resolveAgentRunBilling). */
  ownerId: string | null
  reason: string
  strict: boolean
}

/** The recheck date as the owner reads one, in UTC (the server has no zone for them). */
export function formatRecheck(date: Date, locale: Locale): string {
  return date.toLocaleString(intlTag(locale), {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })
}

const mentionOf = (user: { id: string; name: string | null; email: string | null } | null) =>
  user ? `@[${(user.name || user.email || 'Owner').replace(/[[\]()]/g, '')}](${user.id}) ` : ''

/** Never throws: a notice must not change how the dispatch that raised it ends. */
export async function recordDeliveryNotice(prisma: PrismaClient, input: DeliveryNoticeInput): Promise<void> {
  const { taskId, agentUserId, ownerId, reason, strict } = input
  try {
    if (!agentUserId) {
      log.warn({ taskId, strict }, 'webhook delivery notice skipped: no agent user to sign it')
      return
    }
    let recheckAt: Date | null = null
    if (strict) {
      recheckAt = await parkForStrictDelivery(prisma, taskId, agentUserId)
      if (!recheckAt) return
    }
    const owner = ownerId
      ? await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, email: true, locale: true } })
      : null
    // In the owner's language: the notice is addressed to them.
    const locale = renderLocale(owner?.locale)
    const t = await getNotificationTranslator(locale)
    const body = strict
      ? t('webhookDelivery.strict', { reason, until: formatRecheck(recheckAt!, locale) })
      : t('webhookDelivery.fallback', { reason })
    const { postCommentAs } = await import('@/services/post-comment-as')
    const posted = await postCommentAs({
      taskId,
      authorId: agentUserId,
      content: `${mentionOf(owner)}${body}\n\n${WEBHOOK_DELIVERY_NOTICE_MARKER}\n${SYSTEM_GENERATED_MARKER}`,
    })
    if (!posted.ok) log.error({ taskId, error: posted.error }, 'webhook delivery notice was not posted')
  } catch (err) {
    log.error({ err, taskId, strict }, 'Could not record webhook delivery notice')
  }
}

/**
 * Park a strict-mode task in Waiting, keeping the agent. Returns the recheck
 * date, or null when the task is no longer this agent's open task (a
 * concurrent reassignment or completion wins) or the write was refused.
 */
async function parkForStrictDelivery(prisma: PrismaClient, taskId: string, agentUserId: string): Promise<Date | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { completed: true, assigneeId: true, dueDateTime: true, updatedAt: true, assignee: { select: { name: true } } },
  })
  if (!task || task.completed || task.assigneeId !== agentUserId) return null

  const now = Date.now()
  const due = task.dueDateTime ? new Date(task.dueDateTime) : null
  const keepsDate = due !== null && due.getTime() > now
  const recheckAt = keepsDate ? due : new Date(now + STRICT_PARK_RECHECK_MS)

  const { updateTaskWithSideEffects } = await import('@/services/task.service')
  const result = await updateTaskWithSideEffects({
    taskId,
    actorId: agentUserId,
    actorName: task.assignee?.name ?? undefined,
    actorType: 'agent',
    intent: {
      statusRole: WAITING_STATUS_ROLE,
      keepAssignee: true,
      ...(keepsDate ? {} : { dueDateTime: recheckAt }),
    },
    ifUnmodifiedSince: task.updatedAt ?? null,
  })
  if (!result.ok) {
    log.error({ taskId, status: result.status, code: result.code }, 'strict webhook delivery could not park the task')
    return null
  }
  return recheckAt
}
