/**
 * Notify an AI agent when a comment is added to a task they own.
 *
 * Extracted from lib/ai-agent-webhook-service.ts (`notifyCommentOnAssignedTask`).
 * The original class delegates to this function so the routing logic lives
 * in one place. Helpers that this still needs from the service class
 * (sendToUserWebhook for Claude Code Remote routing, sendWebhookNotification
 * for raw external webhooks) are passed in as deps to avoid moving them
 * yet — Stage 9b will continue the split.
 *
 * Routing order (matching the original):
 *   1. OpenClaw agents → SSE channel plugin (no-op here)
 *   2. Task creator's user-level Claude Code Remote webhook
 *   3. Internal coding agent → tools workflow API
 *   4. Internal assistant agent → assistant workflow API
 *   5. External agent with webhookUrl → direct webhook POST
 */

import type { PrismaClient } from '@prisma/client'
import { mcpTokenStorageFields, resolveMCPPlaintext } from "@/lib/mcp-token"
import { getBaseUrl, getTaskUrl } from '@/lib/base-url'
import { createLogger } from '@/lib/logger'
import { getAgentType } from './agent-type'
import type { TaskAssignmentWebhookPayload } from './types'

const log = createLogger('webhooks/comment-notifier')

export type SendToUserWebhookFn = (
  userId: string,
  event: string,
  payload: TaskAssignmentWebhookPayload,
  agentType: string | null,
) => Promise<{ sent: boolean; status?: number; agentType?: string | null }>

export type SendWebhookNotificationFn = (
  url: string,
  payload: TaskAssignmentWebhookPayload,
) => Promise<void>

export interface CommentNotifierDeps {
  prisma: PrismaClient
  sendToUserWebhook: SendToUserWebhookFn
  sendWebhookNotification: SendWebhookNotificationFn
}

export async function notifyCommentOnAssignedTask(
  args: {
    taskId: string
    commentId: string
    commentContent: string
    commenterName: string
  },
  deps: CommentNotifierDeps,
): Promise<void> {
  const { taskId, commentId, commentContent, commenterName } = args
  const { prisma, sendToUserWebhook, sendWebhookNotification } = deps

  try {
    const task = await prisma.task.findFirst({
      where: { id: taskId },
      include: {
        assignee: true,
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

    if (!task || !task.assignee || !task.assignee.isAIAgent) {
      log.info(`⚠️  Task ${taskId} is not assigned to an AI agent`)
      return
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    })

    if (!comment) {
      log.info(`⚠️  Comment ${commentId} not found`)
      return
    }

    const aiAgentConfig = task.assignee.aiAgentConfig ? JSON.parse(task.assignee.aiAgentConfig) : {}

    let mcpToken = await prisma.mCPToken.findFirst({
      where: { userId: task.assignee.id, isActive: true },
    })

    if (!mcpToken) {
      mcpToken = await prisma.mCPToken.create({
        data: {
          ...mcpTokenStorageFields(`ai-agent-${task.assignee.id}-${Date.now()}`),
          userId: task.assignee.id,
          permissions: ['read', 'write'],
          description: `Auto-generated token for ${task.assignee.name}`,
          isActive: true,
        },
      })
    }

    const payload: TaskAssignmentWebhookPayload = {
      event: 'task.commented',
      timestamp: new Date().toISOString(),
      aiAgent: {
        id: task.assignee.id,
        name: task.assignee.name || 'AI Agent',
        type: task.assignee.aiAgentType || 'unknown',
        email: task.assignee.email,
      },
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDateTime: task.dueDateTime?.toISOString(),
        assigneeId: task.assignee.id,
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
        contextInstructions:
          task.lists[0]?.description ||
          aiAgentConfig.contextInstructions ||
          `Someone has commented on your assigned task. Read the comment and respond if needed using the MCP API.${task.lists[0]?.githubRepositoryId ? `\n\nThis list is configured with GitHub repository: ${task.lists[0].githubRepositoryId}.` : ''}`,
      },
      creator: {
        id: task.creator?.id || task.creatorId,
        name: task.creator?.name || 'Deleted User' || undefined,
        email: task.creator?.email || 'deleted@user.com',
      },
      comment: {
        id: comment.id,
        content: comment.content,
        authorName:
          comment.author?.name || 'Deleted User' || comment.author?.email || 'deleted@user.com',
        authorId: comment.author?.id || null,
        createdAt: comment.createdAt.toISOString(),
      },
      comments: task.comments?.map(c => ({
        id: c.id,
        content: c.content,
        authorName: c.author?.name || c.author?.email || 'Unknown',
        authorId: c.author?.id || null,
        createdAt: c.createdAt.toISOString(),
      })),
    }

    log.info(`🔔 Notifying AI agent ${task.assignee.name} about comment from ${commenterName}`)
    log.info(`📝 Including ${task.comments?.length || 0} comments in payload`)

    const agentType = getAgentType(task.assignee.email ?? undefined, task.assignee.name ?? undefined)

    if (agentType === 'openclaw') {
      log.info(`🐾 OpenClaw agent — comment notification delivered via SSE channel`)
      return
    }

    // FIRST: route through user-level Claude Code Remote webhook if configured.
    const webhookUserId = task.creatorId || task.lists?.[0]?.ownerId
    log.info(`🔍 [WEBHOOK-TRACE] Comment: checking user webhook for ${webhookUserId}`)
    if (webhookUserId) {
      const userWebhookResult = await sendToUserWebhook(webhookUserId, 'comment.created', payload, agentType)
      if (userWebhookResult.sent) {
        log.info(`📤 Routed comment to user's Claude Code Remote server`)
        return
      }
    }

    const isInternalAgent = task.assignee.email?.endsWith('@astrid.cc')
    const { isCodingAgent } = await import('@/lib/ai-agent-utils')

    if (isInternalAgent) {
      const repository = task.lists?.find(l => l.githubRepositoryId)?.githubRepositoryId

      if (repository && isCodingAgent(task.assignee)) {
        log.info(`🤖 Internal coding agent - triggering tools workflow for comment response`)
        try {
          const baseUrl = getBaseUrl()
          await fetch(`${baseUrl}/api/coding-workflow/start-tools-workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: task.id,
              repository,
              userComment: commentContent,
            }),
          })
          log.info(`✅ Tools workflow triggered for comment: "${commentContent}"`)
        } catch (error) {
          log.error({ err: error }, `❌ Failed to trigger tools workflow:`)
        }
      } else {
        log.info(`🤖 Internal assistant agent - triggering real-time workflow for comment response`)
        try {
          const baseUrl = getBaseUrl()
          const response = await fetch(`${baseUrl}/api/assistant-workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: task.id,
              agentEmail: task.assignee.email,
              creatorId: task.creatorId,
              isCommentResponse: true,
              userComment: commentContent,
            }),
          })

          if (response.ok) {
            log.info(`✅ Assistant workflow triggered for comment: "${commentContent}"`)
          } else {
            const errorText = await response.text()
            log.error(`❌ Assistant workflow failed: ${errorText}`)
          }
        } catch (error) {
          log.error({ err: error }, `❌ Failed to trigger assistant workflow:`)
        }
      }
      return
    }

    if (task.assignee.webhookUrl) {
      await sendWebhookNotification(task.assignee.webhookUrl, payload)
    }

    log.info(`✅ Successfully notified AI agent ${task.assignee.name} about comment`)
  } catch (error) {
    log.error({ err: error }, `❌ Failed to notify AI agent about comment:`)
    throw error
  }
}
