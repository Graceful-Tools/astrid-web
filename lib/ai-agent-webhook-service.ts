import { prisma as defaultPrisma } from '@/lib/prisma'
import { PushNotificationService } from '@/lib/push-notification-service'
import { getBaseUrl } from '@/lib/base-url'
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { decryptField } from '@/lib/field-encryption'
import type { PrismaClient } from '@prisma/client'
import { createLogger } from '@/lib/logger'
import { getAgentType } from '@/lib/webhooks/agent-type'
import { notifyCommentOnAssignedTask as notifyCommentOnAssignedTaskImpl } from '@/lib/webhooks/comment-notifier'
import {
  notifyTaskAssignment as notifyTaskAssignmentImpl,
  sendWebhookNotification as sendWebhookNotificationImpl,
} from '@/lib/webhooks/task-assignment-notifier'

const log = createLogger('ai-agent-webhook-service')

// Re-export for external callers that previously imported the type from here.
// The canonical home is now lib/webhooks/types.ts so the notifier modules
// don't need a type-only circular import back to this file.
export type { TaskAssignmentWebhookPayload } from '@/lib/webhooks/types'
import type { TaskAssignmentWebhookPayload } from '@/lib/webhooks/types'

export class AIAgentWebhookService {
  private prisma: PrismaClient
  private pushService: PushNotificationService


  constructor(customPrisma?: PrismaClient) {
    this.prisma = customPrisma || defaultPrisma
    this.pushService = new PushNotificationService(customPrisma)
  }

  /** Delegates to lib/webhooks/task-assignment-notifier.ts. The class
   *  supplies prisma + pushService + the still-in-class sendToUserWebhook
   *  helper. */
  notifyTaskAssignment(
    taskId: string,
    aiAgentId: string,
    event: 'task.assigned' | 'task.updated' = 'task.assigned',
  ): Promise<void> {
    return notifyTaskAssignmentImpl(
      { taskId, aiAgentId, event },
      {
        prisma: this.prisma,
        pushService: this.pushService,
        sendToUserWebhook: this.sendToUserWebhook.bind(this),
      },
    )
  }


  async notifyTaskAssignmentViaAIAgentId(taskId: string, aiAgentId: string, event: 'task.assigned' | 'task.updated' = 'task.assigned') {
    // This is a wrapper for the main notification function that handles aiAgentId assignments
    return this.notifyTaskAssignment(taskId, aiAgentId, event)
  }

  /**
   * Send webhook to user's Claude Code Remote server
   *
   * If the task creator has configured a Claude Code Remote server, this method
   * will send a signed webhook instead of processing via the standard API flow.
   *
   * @param userId - The task creator's user ID
   * @param event - The event type being sent
   * @param payload - The webhook payload
   * @returns Object indicating whether webhook was sent successfully
   */
  async sendToUserWebhook(
    userId: string,
    event: string,
    payload: TaskAssignmentWebhookPayload,
    agentType?: string | null
  ): Promise<{ sent: boolean; error?: string }> {
    log.info(`🔔 [WEBHOOK] sendToUserWebhook called for user ${userId}, event: ${event}, agentType: ${agentType}`)
    log.info(`🔔 [WEBHOOK] ENV CHECK - CLAUDE_REMOTE_WEBHOOK_URL: ${process.env.CLAUDE_REMOTE_WEBHOOK_URL ? 'SET' : 'NOT SET'}`)
    log.info(`🔔 [WEBHOOK] ENV CHECK - CLAUDE_REMOTE_WEBHOOK_SECRET: ${process.env.CLAUDE_REMOTE_WEBHOOK_SECRET ? 'SET' : 'NOT SET'}`)
    try {
      // Get user's webhook config
      const config = await this.prisma.userWebhookConfig.findUnique({
        where: { userId }
      })
      log.info(`🔔 [WEBHOOK] Config found: ${!!config}, enabled: ${config?.enabled}, events: ${config?.events?.join(',')}, agents: ${config?.agents?.join(',')}`)

      // No config or not enabled - check for env-based fallback
      if (!config || !config.enabled) {
        // Try environment-based Claude Remote configuration as fallback
        const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
        const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

        // Only use env fallback for Claude agents (or when agent type is unknown)
        const isClaudeAgentType = !agentType || agentType === 'claude'
        if (envRemoteUrl && envRemoteSecret && isClaudeAgentType) {
          log.info(`📤 [WEBHOOK] No UserWebhookConfig, using env-based Claude Remote: ${envRemoteUrl}`)

          const body = JSON.stringify(payload)
          const headers = generateWebhookHeaders(body, envRemoteSecret, event)

          const response = await fetch(envRemoteUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000)
          })

          if (response.ok) {
            log.info(`✅ Webhook sent to env-configured Claude Code Remote server`)
            return { sent: true }
          } else {
            log.error(`❌ Env-based Claude Remote webhook failed: HTTP ${response.status}`)
            return { sent: false, error: `HTTP ${response.status}` }
          }
        }

        return { sent: false, error: 'No webhook configured' }
      }

      // Check if this event type is subscribed
      if (!config.events.includes(event)) {
        return { sent: false, error: `Event ${event} not subscribed` }
      }

      // Check if this agent type is handled by the webhook (opt-in model)
      // If config.agents is empty or doesn't include this agent, don't send to webhook
      // (let it fall through to polling mode instead)
      if (agentType) {
        const agentsList = config.agents || []
        if (agentsList.length === 0 || !agentsList.includes(agentType)) {
          log.info(`🔔 [WEBHOOK] Agent ${agentType} not in webhook agents list [${agentsList.join(', ')}] - skipping webhook (will use polling)`)
          return { sent: false, error: `Agent ${agentType} not configured for webhook` }
        }
      }

      // Check failure count - fall back to env config if too many failures
      if (config.failureCount >= config.maxRetries) {
        log.info(`⚠️  User webhook disabled due to ${config.failureCount} failures - falling back to env config`)
        // Fall through to env-based config
        const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
        const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

        if (envRemoteUrl && envRemoteSecret) {
          log.info(`📤 [WEBHOOK] Using env-based fallback after user config failure: ${envRemoteUrl}`)

          const body = JSON.stringify(payload)
          const headers = generateWebhookHeaders(body, envRemoteSecret, event)

          const response = await fetch(envRemoteUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000)
          })

          if (response.ok) {
            log.info(`✅ Webhook sent to env-configured server (user config had failures)`)
            return { sent: true }
          } else {
            log.error(`❌ Env-based webhook failed: HTTP ${response.status}`)
            return { sent: false, error: `HTTP ${response.status}` }
          }
        }

        return { sent: false, error: 'Webhook disabled due to failures and no env fallback' }
      }

      // Decrypt URL and secret
      log.info(`🔔 [WEBHOOK] Decrypting URL and secret...`)
      const webhookUrl = decryptField(config.webhookUrl)
      const webhookSecret = decryptField(config.webhookSecret)
      log.info(`🔔 [WEBHOOK] URL decrypted: ${!!webhookUrl}, Secret decrypted: ${!!webhookSecret}`)

      if (!webhookUrl || !webhookSecret) {
        log.info(`🔔 [WEBHOOK] Decryption failed - URL: ${!!webhookUrl}, Secret: ${!!webhookSecret}`)
        return { sent: false, error: 'Invalid webhook configuration' }
      }

      // Generate signed request
      const body = JSON.stringify(payload)
      const headers = generateWebhookHeaders(body, webhookSecret, event)

      log.info(`📤 Sending signed webhook to user's Claude Code Remote server: ${webhookUrl}`)

      // Send with timeout
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000) // 10s timeout
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Reset failure count on success
      await this.prisma.userWebhookConfig.update({
        where: { id: config.id },
        data: {
          lastFiredAt: new Date(),
          failureCount: 0
        }
      })

      log.info(`✅ Webhook sent successfully to user's Claude Code Remote server`)
      return { sent: true }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log.error(`❌ Failed to send user webhook: ${errorMessage}`)

      // Increment failure count
      try {
        await this.prisma.userWebhookConfig.updateMany({
          where: { userId },
          data: { failureCount: { increment: 1 } }
        })
      } catch {
        // Ignore update errors
      }

      return { sent: false, error: errorMessage }
    }
  }

  async notifyTaskUpdate(taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      await this.notifyTaskAssignment(taskId, task.assignee.id, 'task.updated')
    }
  }

  async notifyTaskCompletion(taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      await this.notifyTaskAssignment(taskId, task.assignee.id, 'task.updated')
    }
  }

  /** Delegates to lib/webhooks/comment-notifier.ts. Routing logic + payload
   *  construction live there; the class supplies the still-private dispatch
   *  helpers (Stage 9b will continue the split). */
  notifyCommentOnAssignedTask(
    taskId: string,
    commentId: string,
    commentContent: string,
    commenterName: string,
  ) {
    return notifyCommentOnAssignedTaskImpl(
      { taskId, commentId, commentContent, commenterName },
      {
        prisma: this.prisma,
        sendToUserWebhook: this.sendToUserWebhook.bind(this),
        sendWebhookNotification: sendWebhookNotificationImpl,
      },
    )
  }

  async getAIAgents() {
    return await this.prisma.user.findMany({
      where: { isAIAgent: true, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        aiAgentType: true,
        webhookUrl: true
      }
    })
  }
}

export const aiAgentWebhookService = new AIAgentWebhookService()