import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { buildNotificationRows } from '@/lib/notifications'
import { WAITING_STATUS_ROLE } from '@/lib/task-status'
import { broadcastToUsers } from '@/lib/sse-utils'
import { audienceForTask } from '@/lib/deletion-log'
import { parseWebhookDeliverySettings, resolveWebhookDeliveryPolicy, type WebhookDeliveryPolicy } from '@/lib/webhooks/delivery-policy'
import { broadcastCommentCreated, COMMENT_INCLUDE } from '@/services/comment.service'
import { RedisCache, isRedisAvailable } from '@/lib/redis'

const log = createLogger('services.webhook-delivery')

export async function getWebhookDeliverySettings(userId: string) {
  const user = await defaultPrisma.user.findUnique({
    where: { id: userId }, select: { mcpSettings: true },
  })
  const settings = parseWebhookDeliverySettings(user?.mcpSettings)
  return { policy: resolveWebhookDeliveryPolicy(settings), agents: settings.agentWebhookDeliveryPolicies ?? {} }
}

export async function setWebhookDeliverySettings(userId: string, policy: WebhookDeliveryPolicy, agent?: string) {
  const user = await defaultPrisma.user.findUnique({
    where: { id: userId }, select: { mcpSettings: true },
  })
  const settings = parseWebhookDeliverySettings(user?.mcpSettings)
  const next = agent
    ? { ...settings, agentWebhookDeliveryPolicies: { ...settings.agentWebhookDeliveryPolicies, [agent]: policy } }
    : { ...settings, webhookDeliveryPolicy: policy }
  const saved = await defaultPrisma.user.updateMany({
    where: { id: userId, mcpSettings: user?.mcpSettings ?? null },
    data: { mcpSettings: JSON.stringify(next) },
  })
  if (saved.count === 0) return null
  return { policy: resolveWebhookDeliveryPolicy(next), agents: next.agentWebhookDeliveryPolicies ?? {} }
}

/**
 * An atomic system gate, like claimFixallTask, not a user edit. The conditional
 * lane write and its system comment/owner notification must commit together.
 * Human comment side effects would wake the failing agent again.
 */
export async function recordDeliveryNotice(
  prisma: PrismaClient,
  input: { taskId: string; aiAgentId: string; ownerId: string | null; reason: string; strict: boolean },
): Promise<void> {
  const { taskId, aiAgentId, ownerId, reason, strict } = input
  const content = strict
    ? `<!-- SYSTEM_GENERATED_COMMENT -->\nBLOCKED-ON: webhook delivery failed (${reason})\nStrict delivery policy: no environment webhook or server-side fallback was used. Repair the webhook and move this task to Ready to retry.`
    : `<!-- SYSTEM_GENERATED_COMMENT -->\nWebhook delivery warning: ${reason}. The fallback delivery policy permits the existing environment webhook or server-side route; endpoint acceptance does not confirm the agent started.`
  try {
    const result = await prisma.$transaction(async tx => {
      if (strict) {
        const parked = await tx.task.updateMany({
          where: { id: taskId, completed: false, OR: [{ assigneeId: aiAgentId }, { aiAgentId }] },
          data: { statusRole: WAITING_STATUS_ROLE },
        })
        if (parked.count === 0) return null
      }
      const comment = await tx.comment.create({
        data: { taskId, authorId: null, type: 'MARKDOWN', systemEventType: 'WEBHOOK_DELIVERY_NOTICE', content },
        include: COMMENT_INCLUDE,
      })
      if (ownerId) {
        await tx.notification.createMany({
          data: buildNotificationRows([{ userId: ownerId, kind: 'commented' }], { taskId, commentId: comment.id, actorId: null }),
        })
      }
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { lists: { include: { listMembers: true } } },
      })
      return { comment, task }
    })
    if (!result?.task) return
    const viewers = new Set(audienceForTask(result.task))
    if (ownerId) viewers.add(ownerId)
    viewers.delete(aiAgentId)
    try {
      if (await isRedisAvailable()) {
        await Promise.all([...viewers].map(userId => RedisCache.invalidate.userTasks(userId)))
      }
    } catch (err) {
      log.error({ err, taskId }, 'Could not invalidate delivery notice caches')
    }
    broadcastCommentCreated(result.comment, result.task, null, ownerId ? [ownerId] : [], [aiAgentId])
    if (strict) {
      broadcastToUsers([...viewers], {
        type: 'task_updated', timestamp: new Date().toISOString(), data: { taskId },
      })
    }
  } catch (err) {
    log.error({ err, taskId, strict }, 'Could not persist webhook delivery notice')
    // A warning write must not alter legacy dispatch; strict never proceeds.
    if (strict) throw err
  }
}
