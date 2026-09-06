/**
 * Notify an AI agent when a task is assigned or updated.
 *
 * Extracted from lib/ai-agent-webhook-service.ts (`notifyTaskAssignment` +
 * its three dispatch helpers `sendWebhookNotification`, `sendPushNotification`,
 * `sendSSENotification`). The original class becomes a thin orchestrator
 * delegating to this module + the comment-notifier sibling from Stage 9a.
 *
 * Routing order (matching the original):
 *   1. OpenClaw agents → SSE channel plugin
 *   2. Task creator's user-level Claude Code Remote webhook
 *   3. ENV-configured Claude Code Remote (claude agents only)
 *   4. Internal coding agent → polling worker (no-op here)
 *   5. Internal assistant agent → assistant workflow API
 *   6. External agent with webhookUrl → direct webhook POST
 *   + push notification for astrid-typed agents
 *   + SSE notification to list members
 *
 * The cross-instance "notificationInProgress" guard against infinite
 * re-entry was a `private static` Set on the original class; promoted
 * to a module-level singleton with identical semantics (single class
 * instance app-wide).
 */

import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_EVENT_HEADER } from './protocol-headers'
import { assertPublicOutboundUrl } from '@/lib/security/outbound-url'
import { BRAND } from '@/lib/brand/config'
import type { PrismaClient } from '@prisma/client'
import { mcpTokenStorageFields, resolveMCPPlaintext } from "@/lib/mcp-token"
import { broadcastToUsers } from '@/lib/sse-utils'
import { getBaseUrl, getTaskUrl } from '@/lib/base-url'
import { createLogger } from '@/lib/logger'
import { getAgentType } from './agent-type'
import { isBrandAgentEmail } from '@/lib/brand/agent-emails'
import { isPollingOnlyAgent } from '@/lib/ai/agent-execution-mode'
import { buildAgentContextInstructions } from '@/lib/ai/prompt-trust'
import type { TaskAssignmentWebhookPayload } from './types'
import type { PushNotificationService } from '@/lib/push-notification-service'

const log = createLogger('webhooks/task-assignment-notifier')

const notificationInProgress = new Set<string>()

export type SendToUserWebhookFn = (
  userId: string,
  event: string,
  payload: TaskAssignmentWebhookPayload,
  agentType: string | null,
) => Promise<{ sent: boolean; status?: number; agentType?: string | null }>

export interface TaskAssignmentNotifierDeps {
  prisma: PrismaClient
  pushService: PushNotificationService
  sendToUserWebhook: SendToUserWebhookFn
}

export async function notifyTaskAssignment(
  args: {
    taskId: string
    aiAgentId: string
    event?: 'task.assigned' | 'task.updated'
  },
  deps: TaskAssignmentNotifierDeps,
): Promise<void> {
  const { taskId, aiAgentId, event = 'task.assigned' } = args
  const { prisma, pushService, sendToUserWebhook } = deps

  const notificationKey = `${taskId}:${aiAgentId}:${event}`

  log.info({
    taskId,
    aiAgentId,
    event,
    notificationKey,
    stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
  }, `🔔 [WEBHOOK-SERVICE] notifyTaskAssignment called`)

  if (notificationInProgress.has(notificationKey)) {
    log.info(`🔄 [WEBHOOK-SERVICE] Notification ${notificationKey} already in progress, skipping to prevent infinite loop`)
    return
  }

  notificationInProgress.add(notificationKey)

  try {
    const task = await prisma.task.findFirst({
      where: { id: taskId },
      include: {
        assignee: true,
        aiAgent: true,
        creator: { select: { id: true, name: true, email: true } },
        lists: {
          select: {
            id: true,
            name: true,
            description: true,
            githubRepositoryId: true,
            ownerId: true,
            owner: { select: { id: true, email: true } },
          },
        },
        comments: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
      },
    })

    if (!task) {
      log.info(`⚠️  Task ${taskId} not found`)
      return
    }

    // Reconcile assignee path (User with isAIAgent) vs aiAgent path (direct AIAgent record).
    let agentUser = null
    let agentRecord = null

    if (task.assignee && task.assignee.isAIAgent && task.assignee.id === aiAgentId) {
      agentUser = task.assignee
    } else if (task.aiAgent && task.aiAgent.id === aiAgentId) {
      agentRecord = task.aiAgent
      agentUser = await prisma.user.findFirst({
        where: { email: `${task.aiAgent.name.toLowerCase().replace(/\s+/g, '')}@${BRAND.agentEmailDomain}` },
      })
    }

    if (!agentUser && !agentRecord) {
      log.info(`⚠️  Task ${taskId} not assigned to AI agent ${aiAgentId}`)
      return
    }

    const aiAgentConfig = agentUser?.aiAgentConfig ? JSON.parse(agentUser.aiAgentConfig) : {}
    const agentName = agentRecord?.name || agentUser?.name || 'AI Agent'
    const webhookUrl = agentRecord?.webhookUrl || agentUser?.webhookUrl
    const isInternalAgent = isBrandAgentEmail(agentUser?.email)

    if (!webhookUrl && !isInternalAgent) {
      log.info(`⚠️  No webhook URL configured for external AI agent ${agentName}`)
      return
    }

    let mcpToken = null
    if (agentUser) {
      mcpToken = await prisma.mCPToken.findFirst({
        where: { userId: agentUser.id, isActive: true },
      })

      if (!mcpToken) {
        mcpToken = await prisma.mCPToken.create({
          data: {
            ...mcpTokenStorageFields(`ai-agent-${agentUser.id}-${Date.now()}`),
            userId: agentUser.id,
            permissions: ['read', 'write'],
            description: `Auto-generated token for ${agentName}`,
            isActive: true,
          },
        })
      }
    }

    const payload: TaskAssignmentWebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      aiAgent: {
        id: agentRecord?.id || agentUser?.id || aiAgentId,
        name: agentName,
        type: agentRecord?.service ? `${agentRecord.service}_agent` : (agentUser?.aiAgentType || 'unknown'),
        email: agentUser?.email || `${agentName.toLowerCase().replace(/\s+/g, '')}@${BRAND.agentEmailDomain}`,
      },
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDateTime: task.dueDateTime?.toISOString(),
        assigneeId: agentRecord?.id || agentUser?.id || aiAgentId,
        creatorId: task.creatorId,
        listId: task.lists[0]?.id || '',
        url: getTaskUrl(task.id),
      },
      list: {
        id: task.lists[0]?.id || '',
        name: task.lists[0]?.name || 'Unknown List',
        description: task.lists[0]?.description || undefined,
        githubRepositoryId: task.lists[0]?.githubRepositoryId || undefined,
      },
      mcp: {
        baseUrl: getBaseUrl(),
        operationsEndpoint: '/api/mcp/operations',
        accessToken: (mcpToken && resolveMCPPlaintext(mcpToken)) || 'no-mcp-token',
        availableOperations: [
          'get_shared_lists',
          'get_list_tasks',
          'get_task_details',
          'update_task',
          'add_comment',
          'get_task_comments',
        ],
        contextInstructions: buildAgentContextInstructions(
          task.lists[0]?.description,
          aiAgentConfig.contextInstructions ||
            `Use the MCP API to read task details, add progress comments, and mark the task complete when finished.${task.lists[0]?.githubRepositoryId ? ` This list is configured with GitHub repository: ${task.lists[0].githubRepositoryId}.` : ''}`,
        ),
      },
      creator: {
        id: task.creator?.id || task.creatorId,
        name: task.creator?.name || 'Deleted User' || undefined,
        email: task.creator?.email || 'deleted@user.com',
      },
      comments: task.comments?.map(c => ({
        id: c.id,
        content: c.content,
        authorName: c.author?.name || c.author?.email || 'Unknown',
        authorId: c.author?.id || null,
        createdAt: c.createdAt.toISOString(),
      })),
    }

    log.info({ taskTitle: payload.task.title }, `🔔 Notifying AI agent ${agentName} about ${event}`)
    log.info(`📝 Including ${task.comments?.length || 0} comments in payload`)

    const agentType = getAgentType(agentUser?.email ?? undefined, agentRecord?.name ?? agentName)
    log.info(`🔍 [WEBHOOK-TRACE] Agent type: ${agentType} (from email: ${agentUser?.email}, name: ${agentRecord?.name})`)

    if (agentType === 'openclaw') {
      log.info(`🐾 OpenClaw agent detected — routing via SSE channel plugin (no webhook needed)`)
      await sendSSENotification(task, payload, prisma)
      return
    }

    // Whoever owns this run pays for it and therefore chooses how it runs.
    const webhookUserId = task.creatorId || task.lists?.[0]?.ownerId

    // Polling mode: the assignment IS the notification. It lands in the agent's
    // queue and the user's own harness claims it on its next loop, so nothing is
    // pushed and no provider is called. The SSE event still goes out — that is
    // what makes the task appear in an open app immediately.
    if (await isPollingOnlyAgent(agentUser?.email, webhookUserId)) {
      log.info(`💻 ${agentName} runs in polling mode — the harness will claim this from its queue`)
      await sendSSENotification(task, payload, prisma)
      return
    }

    // FIRST: route through user-level Claude Code Remote webhook if configured.
    log.info(`🔍 [WEBHOOK-TRACE] Checking user webhook for user ${webhookUserId} (creatorId: ${task.creatorId}, listOwner: ${task.lists?.[0]?.ownerId})...`)
    if (webhookUserId) {
      const userWebhookResult = await sendToUserWebhook(webhookUserId, event, payload, agentType)
      log.info({ userWebhookResult }, `🔍 [WEBHOOK-TRACE] sendToUserWebhook result`)

      if (userWebhookResult.sent) {
        log.info(`📤 Routed to user's Claude Code Remote server (skipping standard flow)`)
        await sendSSENotification(task, payload, prisma)
        return
      }
    }

    // SECOND: ENV-configured Claude Remote fallback for claude-typed agents.
    const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
    const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET
    const isClaudeAgent = agentType === 'claude'
    log.info(`🔍 [WEBHOOK-TRACE] ENV check: URL=${!!envRemoteUrl}, SECRET=${!!envRemoteSecret}, isClaudeAgent=${isClaudeAgent}, isInternalAgent=${isInternalAgent}`)
    if (envRemoteUrl && envRemoteSecret && isClaudeAgent) {
      log.info(`📤 Sending to env-configured Claude Code Remote: ${envRemoteUrl}`)
      try {
        const { generateWebhookHeaders } = await import('@/lib/webhook-signature')
        const body = JSON.stringify(payload)
        const headers = generateWebhookHeaders(body, envRemoteSecret, event)

        const response = await fetch(envRemoteUrl, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        })

        if (response.ok) {
          log.info(`✅ Webhook sent to Claude Code Remote server`)
          await sendSSENotification(task, payload, prisma)
          return
        } else {
          log.error(`❌ Claude Remote webhook failed: HTTP ${response.status}`)
        }
      } catch (error) {
        log.error({ err: error }, `❌ Claude Remote webhook error:`)
      }
    }

    // THIRD: internal-vs-external split.
    if (isInternalAgent) {
      const hasRepository = task.lists?.some(l => l.githubRepositoryId)
      const { isCodingAgent } = await import('@/lib/ai-agent-utils')
      const isCoding = agentUser && isCodingAgent(agentUser)

      if (hasRepository && isCoding) {
        log.info(`🤖 Internal coding agent ${agentName} - polling worker will handle this`)
        log.info(`   Repository: ${task.lists?.find(l => l.githubRepositoryId)?.githubRepositoryId}`)
      } else {
        log.info(`🤖 Internal assistant agent ${agentName} - triggering real-time workflow`)
        try {
          // Called directly rather than by fetching this app's own
          // /api/assistant-workflow, which is why that route accepted anonymous
          // requests and has now been deleted (task 12b3478d).
          const { runAssistantWorkflow } = await import('@/lib/assistant-workflow/run-assistant-workflow')
          const result = await runAssistantWorkflow({
            taskId: task.id,
            agentEmail: agentUser?.email || payload.aiAgent.email,
            creatorId: task.creatorId,
            isCommentResponse: false,
          })

          if (result.ok) {
            log.info(`✅ Assistant workflow triggered for task: ${task.title}`)
          } else {
            log.error(`❌ Assistant workflow failed: ${result.error}`)
          }
        } catch (error) {
          log.error({ err: error }, `❌ Failed to trigger assistant workflow:`)
        }
      }
    } else if (webhookUrl) {
      await sendWebhookNotification(webhookUrl, payload)
    }

    if (agentUser?.aiAgentType === 'astrid') {
      await sendPushNotification(aiAgentId, payload, pushService)
    }

    await sendSSENotification(task, payload, prisma)

    log.info(`✅ Successfully notified AI agent ${agentName}`)
  } catch (error) {
    log.error({ err: error }, `❌ Failed to notify AI agent about task assignment:`)
    throw error
  } finally {
    notificationInProgress.delete(notificationKey)
    log.info(`🧹 [task-assignment-notifier] Removed notification tracking for ${notificationKey}`)
  }
}

/** Direct external webhook POST. Throws on non-2xx so the caller can log it. */
export async function sendWebhookNotification(
  webhookUrl: string,
  payload: TaskAssignmentWebhookPayload,
): Promise<void> {
  try {
    // Re-check before every delivery, not only on save. A hostname that
    // resolved publicly when the user saved it can resolve to 127.0.0.1 today,
    // so validating once at save time is a DNS-rebinding hole rather than a
    // defence (task 3794f4ce).
    await assertPublicOutboundUrl(webhookUrl)

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `${BRAND.appName}-Task-Manager/1.0`,
        [WEBHOOK_EVENT_HEADER]: payload.event,
        [WEBHOOK_TIMESTAMP_HEADER]: payload.timestamp,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}: ${response.statusText}`)
    }

    log.info(`📤 Webhook sent successfully to ${webhookUrl}`)
  } catch (error) {
    log.error({ err: error }, `❌ Failed to send webhook to ${webhookUrl}:`)
    throw error
  }
}

/** Push notification to a user's subscribed devices. Errors are logged, not thrown. */
async function sendPushNotification(
  userId: string,
  payload: TaskAssignmentWebhookPayload,
  pushService: PushNotificationService,
): Promise<void> {
  try {
    await pushService.sendNotification(userId, {
      title: 'New Task Assignment',
      body: `You've been assigned: ${payload.task.title}`,
      data: {
        taskId: payload.task.id,
        action: 'task_assigned',
        url: payload.task.url,
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      actions: [
        { action: 'view_task', title: 'View Task' },
        { action: 'start_work', title: 'Start Working' },
      ],
    })
  } catch (error) {
    log.error({ err: error }, `❌ Failed to send push notification:`)
  }
}

/** SSE fanout to task creator + all members of the lists the task belongs to,
 *  excluding the AI agent itself. Errors are logged, not thrown. */
export async function sendSSENotification(
  task: any,
  payload: TaskAssignmentWebhookPayload,
  prisma: PrismaClient,
): Promise<void> {
  try {
    const notifyUserIds = new Set<string>()

    if (task.creator?.id) {
      notifyUserIds.add(task.creator?.id || task.creatorId)
    }

    const listIds = task.lists.map((list: { id: string }) => list.id)
    const listsWithMembers = listIds.length > 0
      ? await prisma.taskList.findMany({
          where: { id: { in: listIds } },
          select: {
            id: true,
            ownerId: true,
            listMembers: { select: { userId: true } },
          },
        })
      : []

    for (const list of listsWithMembers) {
      if (list.ownerId) {
        notifyUserIds.add(list.ownerId)
      }
      list.listMembers.forEach(listMember => notifyUserIds.add(listMember.userId))
    }

    notifyUserIds.delete(task.assigneeId!)

    const userIdsArray = Array.from(notifyUserIds)
    if (userIdsArray.length > 0) {
      broadcastToUsers(userIdsArray, {
        type: 'ai_agent_assigned',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          aiAgentName: payload.aiAgent.name,
          aiAgentType: payload.aiAgent.type,
          listNames: task.lists?.map((list: any) => list.name) || [],
          event: payload.event,
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDateTime: task.dueDateTime,
            assigneeId: task.assigneeId,
            creatorId: task.creatorId,
          },
          aiAgent: payload.aiAgent,
        },
      })

      log.info(`📡 Sent SSE notification to ${userIdsArray.length} users about AI agent assignment`)
    }
  } catch (error) {
    log.error({ err: error }, `❌ Failed to send SSE notification:`)
  }
}
