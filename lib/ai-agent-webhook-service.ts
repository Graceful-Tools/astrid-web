import { prisma as defaultPrisma } from '@/lib/prisma'
import { PushNotificationService } from '@/lib/push-notification-service'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getBaseUrl, getTaskUrl } from '@/lib/base-url'
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { decryptField } from '@/lib/field-encryption'
import type { PrismaClient } from '@prisma/client'

/**
 * Extract agent type from email (e.g., claude@astrid.cc -> claude)
 * or from agent name (e.g., "Claude" -> claude, "OpenAI" -> openai)
 */
function getAgentType(email?: string, name?: string): string | null {
  // Check for OpenClaw agent pattern: {name}.oc@astrid.cc
  if (email?.match(/^[a-z0-9._-]+\.oc@astrid\.cc$/i)) {
    return 'openclaw'
  }

  // Try email first (e.g., claude@astrid.cc, openai@astrid.cc, gemini@astrid.cc, openclaw@astrid.cc)
  if (email?.endsWith('@astrid.cc')) {
    const prefix = email.split('@')[0].toLowerCase()
    // Normalize: claude, openai, gemini, openclaw are the standard types
    if (['claude', 'openai', 'gemini', 'openclaw'].includes(prefix)) {
      return prefix
    }
  }

  // Fall back to name matching
  if (name) {
    const lowerName = name.toLowerCase()
    if (lowerName.includes('claude')) return 'claude'
    if (lowerName.includes('openai') || lowerName.includes('gpt')) return 'openai'
    if (lowerName.includes('gemini')) return 'gemini'
    if (lowerName.includes('openclaw') || lowerName.includes('claw')) return 'openclaw'
  }

  return null
}

export interface TaskAssignmentWebhookPayload {
  event: 'task.assigned' | 'task.updated' | 'task.completed' | 'task.commented'
  timestamp: string
  aiAgent: {
    id: string
    name: string
    type: string
    email: string
  }
  task: {
    id: string
    title: string
    description: string
    priority: number
    dueDateTime?: string
    assigneeId: string
    creatorId: string | null
    listId: string
    url: string
  }
  list: {
    id: string
    name: string
    description?: string
    githubRepositoryId?: string
  }
  mcp: {
    baseUrl: string
    operationsEndpoint: string
    accessToken?: string
    availableOperations: string[]
    contextInstructions: string
  }
  creator: {
    id: string | null
    name?: string
    email: string
  }
  comment?: {
    id: string
    content: string
    authorName: string
    authorId: string | null
    createdAt: string
  }
  // Full comment history for context (used by Claude Code Remote)
  comments?: Array<{
    id: string
    content: string
    authorName: string
    authorId: string | null
    createdAt: string
  }>
}

export class AIAgentWebhookService {
  private prisma: PrismaClient
  private pushService: PushNotificationService

  // Global tracking to prevent infinite loops across all instances
  private static notificationInProgress = new Set<string>()

  constructor(customPrisma?: PrismaClient) {
    this.prisma = customPrisma || defaultPrisma
    this.pushService = new PushNotificationService(customPrisma)
  }

  async notifyTaskAssignment(taskId: string, aiAgentId: string, event: 'task.assigned' | 'task.updated' = 'task.assigned') {
    // Create unique key for this notification to prevent infinite loops
    const notificationKey = `${taskId}:${aiAgentId}:${event}`

    console.log(`🔔 [WEBHOOK-SERVICE] notifyTaskAssignment called:`, {
      taskId,
      aiAgentId,
      event,
      notificationKey,
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    })

    // Check if this exact notification is already in progress
    if (AIAgentWebhookService.notificationInProgress.has(notificationKey)) {
      console.log(`🔄 [WEBHOOK-SERVICE] Notification ${notificationKey} already in progress, skipping to prevent infinite loop`)
      return
    }

    // Mark this notification as in progress
    AIAgentWebhookService.notificationInProgress.add(notificationKey)

    try {
      // Get task details with all related data (support both assignee and aiAgent paths)
      const task = await this.prisma.task.findFirst({
        where: { id: taskId },
        include: {
          assignee: true,
          aiAgent: true,
          creator: {
            select: { id: true, name: true, email: true }
          },
          lists: {
            select: {
              id: true,
              name: true,
              description: true,
              githubRepositoryId: true,
              ownerId: true,
              owner: { select: { id: true, email: true } }
            }
          },
          comments: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: {
                select: { id: true, name: true, email: true }
              }
            },
            orderBy: { createdAt: 'asc' },
            take: 50 // Limit to last 50 comments for context
          }
        }
      })

      if (!task) {
        console.log(`⚠️  Task ${taskId} not found`)
        return
      }

      // Check if task is assigned to AI agent via either path
      let agentUser = null
      let agentRecord = null

      if (task.assignee && task.assignee.isAIAgent && task.assignee.id === aiAgentId) {
        // Old path: assignee is a user with isAIAgent = true
        agentUser = task.assignee
      } else if (task.aiAgent && task.aiAgent.id === aiAgentId) {
        // New path: direct aiAgent reference
        agentRecord = task.aiAgent
        // Get the corresponding user record if exists
        agentUser = await this.prisma.user.findFirst({
          where: { email: `${task.aiAgent.name.toLowerCase().replace(/\s+/g, '')}@astrid.cc` }
        })
      }

      if (!agentUser && !agentRecord) {
        console.log(`⚠️  Task ${taskId} not assigned to AI agent ${aiAgentId}`)
        return
      }

      // Get AI agent config
      const aiAgentConfig = agentUser?.aiAgentConfig ? JSON.parse(agentUser.aiAgentConfig) : {}

      // Determine agent name and webhook URL
      const agentName = agentRecord?.name || agentUser?.name || 'AI Agent'
      const webhookUrl = agentRecord?.webhookUrl || agentUser?.webhookUrl

      // Check if this is an internal AI agent (astrid.cc email)
      const isInternalAgent = agentUser?.email?.endsWith('@astrid.cc')

      if (!webhookUrl && !isInternalAgent) {
        console.log(`⚠️  No webhook URL configured for external AI agent ${agentName}`)
        return
      }

      // Get or create MCP token for the AI agent (use user ID if available, otherwise skip MCP)
      let mcpToken = null
      if (agentUser) {
        mcpToken = await this.prisma.mCPToken.findFirst({
          where: {
            userId: agentUser.id,
            isActive: true
          }
        })

        if (!mcpToken) {
          // Create MCP token for AI agent
          mcpToken = await this.prisma.mCPToken.create({
            data: {
              token: `ai-agent-${agentUser.id}-${Date.now()}`,
              userId: agentUser.id,
              permissions: ['read', 'write'],
              description: `Auto-generated token for ${agentName}`,
              isActive: true
            }
          })
        }
      }

      // Build webhook payload
      const payload: TaskAssignmentWebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        aiAgent: {
          id: agentRecord?.id || agentUser?.id || aiAgentId,
          name: agentName,
          type: agentRecord?.service ? `${agentRecord.service}_agent` : (agentUser?.aiAgentType || 'unknown'),
          email: agentUser?.email || `${agentName.toLowerCase().replace(/\s+/g, '')}@astrid.cc`
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
          url: getTaskUrl(task.id)
        },
        list: {
          id: task.lists[0]?.id || '',
          name: task.lists[0]?.name || 'Unknown List',
          description: task.lists[0]?.description || undefined,
          githubRepositoryId: task.lists[0]?.githubRepositoryId || undefined
        },
        mcp: {
          baseUrl: getBaseUrl(),
          operationsEndpoint: '/api/mcp/operations',
          accessToken: mcpToken?.token || 'no-mcp-token',
          availableOperations: [
            'get_shared_lists',
            'get_list_tasks',
            'get_task_details',
            'update_task',
            'add_comment',
            'get_task_comments'
          ],
          contextInstructions: task.lists[0]?.description || aiAgentConfig.contextInstructions || `You have been assigned a task in Astrid. Use the MCP API to read task details, add progress comments, and mark the task complete when finished.${task.lists[0]?.githubRepositoryId ? `\n\nThis list is configured with GitHub repository: ${task.lists[0].githubRepositoryId}.` : ''}`
        },
        creator: {
          id: task.creator?.id || task.creatorId,
          name: task.creator?.name || "Deleted User" || undefined,
          email: task.creator?.email || "deleted@user.com"
        },
        // Include comment history for Claude Code Remote context
        comments: task.comments?.map(c => ({
          id: c.id,
          content: c.content,
          authorName: c.author?.name || c.author?.email || 'Unknown',
          authorId: c.author?.id || null,
          createdAt: c.createdAt.toISOString()
        }))
      }

      console.log(`🔔 Notifying AI agent ${agentName} about ${event}:`, payload.task.title)
      console.log(`📝 Including ${task.comments?.length || 0} comments in payload`)

      // Determine agent type for routing (claude, openai, gemini)
      const agentType = getAgentType(agentUser?.email ?? undefined, agentRecord?.name ?? agentName)
      console.log(`🔍 [WEBHOOK-TRACE] Agent type: ${agentType} (from email: ${agentUser?.email}, name: ${agentRecord?.name})`)

      // OpenClaw agents connect via SSE channel plugin — no webhook or workflow trigger needed
      if (agentType === 'openclaw') {
        console.log(`🐾 OpenClaw agent detected — routing via SSE channel plugin (no webhook needed)`)
        await this.sendSSENotification(task, payload)
        return
      }

      // FIRST: Check if task creator OR list owner has Claude Code Remote configured
      // If so, route to their self-hosted server instead of standard processing
      // Fall back to list owner when creatorId is null (common for tasks created via mobile apps)
      const webhookUserId = task.creatorId || task.lists?.[0]?.ownerId
      console.log(`🔍 [WEBHOOK-TRACE] Checking user webhook for user ${webhookUserId} (creatorId: ${task.creatorId}, listOwner: ${task.lists?.[0]?.ownerId})...`)
      if (webhookUserId) {
        const userWebhookResult = await this.sendToUserWebhook(
          webhookUserId,
          event,
          payload,
          agentType
        )
        console.log(`🔍 [WEBHOOK-TRACE] sendToUserWebhook result:`, userWebhookResult)

        if (userWebhookResult.sent) {
          console.log(`📤 Routed to user's Claude Code Remote server (skipping standard flow)`)
          // Still send SSE notification to keep UI updated
          await this.sendSSENotification(task, payload)
          return
        }
        // Fall through to env-based or standard processing if webhook not configured or failed
      }

      // SECOND: Check for environment-based Claude Remote configuration (fallback)
      // Works for internal agents OR any agent assigned to astrid.cc
      const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
      const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET
      const isClaudeAgent = agentType === 'claude'
      console.log(`🔍 [WEBHOOK-TRACE] ENV check: URL=${!!envRemoteUrl}, SECRET=${!!envRemoteSecret}, isClaudeAgent=${isClaudeAgent}, isInternalAgent=${isInternalAgent}`)
      if (envRemoteUrl && envRemoteSecret && isClaudeAgent) {
        console.log(`📤 Sending to env-configured Claude Code Remote: ${envRemoteUrl}`)
        try {
          const { generateWebhookHeaders } = await import('@/lib/webhook-signature')
          const body = JSON.stringify(payload)
          const headers = generateWebhookHeaders(body, envRemoteSecret, event)

          const response = await fetch(envRemoteUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000)
          })

          if (response.ok) {
            console.log(`✅ Webhook sent to Claude Code Remote server`)
            await this.sendSSENotification(task, payload)
            return
          } else {
            console.error(`❌ Claude Remote webhook failed: HTTP ${response.status}`)
          }
        } catch (error) {
          console.error(`❌ Claude Remote webhook error:`, error)
        }
        // Fall through to standard processing if env webhook failed
      }

      // Handle internal vs external agents differently
      if (isInternalAgent) {
        // Check if this is a coding task (has GitHub repository) or assistant task
        const hasRepository = task.lists?.some(l => l.githubRepositoryId)
        const { isCodingAgent } = await import('@/lib/ai-agent-utils')
        const isCoding = agentUser && isCodingAgent(agentUser)

        if (hasRepository && isCoding) {
          console.log(`🤖 Internal coding agent ${agentName} - polling worker will handle this`)
          console.log(`   Repository: ${task.lists?.find(l => l.githubRepositoryId)?.githubRepositoryId}`)
          // Coding workflow handled by polling-based worker
        } else {
          console.log(`🤖 Internal assistant agent ${agentName} - triggering real-time workflow`)
          // Non-coding task: trigger assistant workflow immediately
          try {
            const baseUrl = getBaseUrl()
            const response = await fetch(`${baseUrl}/api/assistant-workflow`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: task.id,
                agentEmail: agentUser?.email || payload.aiAgent.email,
                creatorId: task.creatorId,
                isCommentResponse: false
              })
            })

            if (response.ok) {
              console.log(`✅ Assistant workflow triggered for task: ${task.title}`)
            } else {
              const error = await response.text()
              console.error(`❌ Assistant workflow failed: ${error}`)
            }
          } catch (error) {
            console.error(`❌ Failed to trigger assistant workflow:`, error)
          }
        }

      } else if (webhookUrl) {
        // Send external webhook notification
        await this.sendWebhookNotification(webhookUrl, payload)
      }

      // Also send push notification if the AI agent has subscriptions (for internal agents)
      if (agentUser?.aiAgentType === 'astrid') {
        await this.sendPushNotification(aiAgentId, payload)
      }

      // Send SSE notification to task creator and list members about AI assignment
      await this.sendSSENotification(task, payload)

      console.log(`✅ Successfully notified AI agent ${agentName}`)

    } catch (error) {
      console.error(`❌ Failed to notify AI agent about task assignment:`, error)
      throw error
    } finally {
      // Always remove the notification from tracking to allow future notifications
      AIAgentWebhookService.notificationInProgress.delete(notificationKey)
      console.log(`🧹 [AIAgentWebhookService] Removed notification tracking for ${notificationKey}`)
    }
  }

  private async sendWebhookNotification(webhookUrl: string, payload: TaskAssignmentWebhookPayload) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Astrid-Task-Manager/1.0',
          'X-Astrid-Event': payload.event,
          'X-Astrid-Timestamp': payload.timestamp
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}: ${response.statusText}`)
      }

      console.log(`📤 Webhook sent successfully to ${webhookUrl}`)
    } catch (error) {
      console.error(`❌ Failed to send webhook to ${webhookUrl}:`, error)
      throw error
    }
  }

  private async sendPushNotification(userId: string, payload: TaskAssignmentWebhookPayload) {
    try {
      await this.pushService.sendNotification(userId, {
        title: `New Task Assignment`,
        body: `You've been assigned: ${payload.task.title}`,
        data: {
          taskId: payload.task.id,
          action: 'task_assigned',
          url: payload.task.url
        },
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        actions: [
          {
            action: 'view_task',
            title: 'View Task'
          },
          {
            action: 'start_work',
            title: 'Start Working'
          }
        ]
      })
    } catch (error) {
      console.error(`❌ Failed to send push notification:`, error)
    }
  }

  private async sendSSENotification(task: any, payload: TaskAssignmentWebhookPayload) {
    try {
      // Get list members who should be notified
      const notifyUserIds = new Set<string>()

      // Add task creator
      if (task.creator?.id) {
        notifyUserIds.add(task.creator?.id || task.creatorId)
      }

      // Add list members for all associated lists
      for (const list of task.lists) {
        const listWithMembers = await this.prisma.taskList.findUnique({
          where: { id: list.id },
          include: {
            owner: true,
            listMembers: {
              include: { user: true }
            }
          }
        })

        if (listWithMembers) {
          // Add owner
          if (listWithMembers.ownerId) {
            notifyUserIds.add(listWithMembers.ownerId)
          }

          // Add list members
          listWithMembers.listMembers.forEach(listMember => {
            notifyUserIds.add(listMember.user.id)
          })
        }
      }

      // Remove AI agent from notifications (they don't need SSE)
      notifyUserIds.delete(task.assigneeId!)

      // Send SSE notification
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
              creatorId: task.creatorId
            },
            aiAgent: payload.aiAgent
          }
        })

        console.log(`📡 Sent SSE notification to ${userIdsArray.length} users about AI agent assignment`)
      }
    } catch (error) {
      console.error(`❌ Failed to send SSE notification:`, error)
    }
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
    console.log(`🔔 [WEBHOOK] sendToUserWebhook called for user ${userId}, event: ${event}, agentType: ${agentType}`)
    console.log(`🔔 [WEBHOOK] ENV CHECK - CLAUDE_REMOTE_WEBHOOK_URL: ${process.env.CLAUDE_REMOTE_WEBHOOK_URL ? 'SET' : 'NOT SET'}`)
    console.log(`🔔 [WEBHOOK] ENV CHECK - CLAUDE_REMOTE_WEBHOOK_SECRET: ${process.env.CLAUDE_REMOTE_WEBHOOK_SECRET ? 'SET' : 'NOT SET'}`)
    try {
      // Get user's webhook config
      const config = await this.prisma.userWebhookConfig.findUnique({
        where: { userId }
      })
      console.log(`🔔 [WEBHOOK] Config found: ${!!config}, enabled: ${config?.enabled}, events: ${config?.events?.join(',')}, agents: ${config?.agents?.join(',')}`)

      // No config or not enabled - check for env-based fallback
      if (!config || !config.enabled) {
        // Try environment-based Claude Remote configuration as fallback
        const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
        const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

        // Only use env fallback for Claude agents (or when agent type is unknown)
        const isClaudeAgentType = !agentType || agentType === 'claude'
        if (envRemoteUrl && envRemoteSecret && isClaudeAgentType) {
          console.log(`📤 [WEBHOOK] No UserWebhookConfig, using env-based Claude Remote: ${envRemoteUrl}`)

          const body = JSON.stringify(payload)
          const headers = generateWebhookHeaders(body, envRemoteSecret, event)

          const response = await fetch(envRemoteUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000)
          })

          if (response.ok) {
            console.log(`✅ Webhook sent to env-configured Claude Code Remote server`)
            return { sent: true }
          } else {
            console.error(`❌ Env-based Claude Remote webhook failed: HTTP ${response.status}`)
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
          console.log(`🔔 [WEBHOOK] Agent ${agentType} not in webhook agents list [${agentsList.join(', ')}] - skipping webhook (will use polling)`)
          return { sent: false, error: `Agent ${agentType} not configured for webhook` }
        }
      }

      // Check failure count - fall back to env config if too many failures
      if (config.failureCount >= config.maxRetries) {
        console.log(`⚠️  User webhook disabled due to ${config.failureCount} failures - falling back to env config`)
        // Fall through to env-based config
        const envRemoteUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
        const envRemoteSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

        if (envRemoteUrl && envRemoteSecret) {
          console.log(`📤 [WEBHOOK] Using env-based fallback after user config failure: ${envRemoteUrl}`)

          const body = JSON.stringify(payload)
          const headers = generateWebhookHeaders(body, envRemoteSecret, event)

          const response = await fetch(envRemoteUrl, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10000)
          })

          if (response.ok) {
            console.log(`✅ Webhook sent to env-configured server (user config had failures)`)
            return { sent: true }
          } else {
            console.error(`❌ Env-based webhook failed: HTTP ${response.status}`)
            return { sent: false, error: `HTTP ${response.status}` }
          }
        }

        return { sent: false, error: 'Webhook disabled due to failures and no env fallback' }
      }

      // Decrypt URL and secret
      console.log(`🔔 [WEBHOOK] Decrypting URL and secret...`)
      const webhookUrl = decryptField(config.webhookUrl)
      const webhookSecret = decryptField(config.webhookSecret)
      console.log(`🔔 [WEBHOOK] URL decrypted: ${!!webhookUrl}, Secret decrypted: ${!!webhookSecret}`)

      if (!webhookUrl || !webhookSecret) {
        console.log(`🔔 [WEBHOOK] Decryption failed - URL: ${!!webhookUrl}, Secret: ${!!webhookSecret}`)
        return { sent: false, error: 'Invalid webhook configuration' }
      }

      // Generate signed request
      const body = JSON.stringify(payload)
      const headers = generateWebhookHeaders(body, webhookSecret, event)

      console.log(`📤 Sending signed webhook to user's Claude Code Remote server: ${webhookUrl}`)

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

      console.log(`✅ Webhook sent successfully to user's Claude Code Remote server`)
      return { sent: true }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`❌ Failed to send user webhook: ${errorMessage}`)

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

  async notifyCommentOnAssignedTask(taskId: string, commentId: string, commentContent: string, commenterName: string) {
    try {
      // Get task details with assignee info and comment history
      const task = await this.prisma.task.findFirst({
        where: { id: taskId },
        include: {
          assignee: true,
          creator: {
            select: { id: true, name: true, email: true }
          },
          lists: {
            select: {
              id: true,
              name: true,
              description: true,
              githubRepositoryId: true,
              ownerId: true,
              owner: { select: { id: true, email: true } }
            }
          },
          comments: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: {
                select: { id: true, name: true, email: true }
              }
            },
            orderBy: { createdAt: 'asc' },
            take: 50 // Limit to last 50 comments for context
          }
        }
      })

      if (!task || !task.assignee || !task.assignee.isAIAgent) {
        console.log(`⚠️  Task ${taskId} is not assigned to an AI agent`)
        return
      }

      // Get comment details
      const comment = await this.prisma.comment.findUnique({
        where: { id: commentId },
        include: {
          author: {
            select: { id: true, name: true, email: true }
          }
        }
      })

      if (!comment) {
        console.log(`⚠️  Comment ${commentId} not found`)
        return
      }

      // Get AI agent config
      const aiAgentConfig = task.assignee.aiAgentConfig ? JSON.parse(task.assignee.aiAgentConfig) : {}

      // Get or create MCP token for the AI agent
      let mcpToken = await this.prisma.mCPToken.findFirst({
        where: {
          userId: task.assignee.id,
          isActive: true
        }
      })

      if (!mcpToken) {
        // Create MCP token for AI agent
        mcpToken = await this.prisma.mCPToken.create({
          data: {
            token: `ai-agent-${task.assignee.id}-${Date.now()}`,
            userId: task.assignee.id,
            permissions: ['read', 'write'],
            description: `Auto-generated token for ${task.assignee.name}`,
            isActive: true
          }
        })
      }

      // Build webhook payload for comment notification
      const payload: TaskAssignmentWebhookPayload = {
        event: 'task.commented',
        timestamp: new Date().toISOString(),
        aiAgent: {
          id: task.assignee.id,
          name: task.assignee.name || 'AI Agent',
          type: task.assignee.aiAgentType || 'unknown',
          email: task.assignee.email
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
          url: getTaskUrl(task.id)
        },
        list: {
          id: task.lists[0]?.id || '',
          name: task.lists[0]?.name || 'Unknown List',
          description: task.lists[0]?.description || undefined,
          githubRepositoryId: task.lists[0]?.githubRepositoryId || undefined
        },
        mcp: {
          baseUrl: getBaseUrl(),
          operationsEndpoint: '/api/mcp/operations',
          accessToken: mcpToken?.token || 'no-mcp-token',
          availableOperations: [
            'get_shared_lists',
            'get_list_tasks',
            'get_task_details',
            'update_task',
            'add_comment',
            'get_task_comments'
          ],
          contextInstructions: task.lists[0]?.description || aiAgentConfig.contextInstructions || `Someone has commented on your assigned task. Read the comment and respond if needed using the MCP API.${task.lists[0]?.githubRepositoryId ? `\n\nThis list is configured with GitHub repository: ${task.lists[0].githubRepositoryId}.` : ''}`
        },
        creator: {
          id: task.creator?.id || task.creatorId,
          name: task.creator?.name || "Deleted User" || undefined,
          email: task.creator?.email || "deleted@user.com"
        },
        comment: {
          id: comment.id,
          content: comment.content,
          authorName: comment.author?.name || "Deleted User" || comment.author?.email || "deleted@user.com",
          authorId: comment.author?.id || null,
          createdAt: comment.createdAt.toISOString()
        },
        // Include full comment history for Claude Code Remote context
        comments: task.comments?.map(c => ({
          id: c.id,
          content: c.content,
          authorName: c.author?.name || c.author?.email || 'Unknown',
          authorId: c.author?.id || null,
          createdAt: c.createdAt.toISOString()
        }))
      }

      console.log(`🔔 Notifying AI agent ${task.assignee.name} about comment from ${commenterName}`)
      console.log(`📝 Including ${task.comments?.length || 0} comments in payload`)

      // Determine agent type for routing
      const agentType = getAgentType(task.assignee.email ?? undefined, task.assignee.name ?? undefined)

      // OpenClaw agents connect via SSE channel plugin — comment delivered via SSE
      if (agentType === 'openclaw') {
        console.log(`🐾 OpenClaw agent — comment notification delivered via SSE channel`)
        return
      }

      // FIRST: Check if task creator OR list owner has Claude Code Remote configured
      // Fall back to list owner when creatorId is null
      const webhookUserId = task.creatorId || task.lists?.[0]?.ownerId
      console.log(`🔍 [WEBHOOK-TRACE] Comment: checking user webhook for ${webhookUserId}`)
      if (webhookUserId) {
        const userWebhookResult = await this.sendToUserWebhook(
          webhookUserId,
          'comment.created',
          payload,
          agentType
        )

        if (userWebhookResult.sent) {
          console.log(`📤 Routed comment to user's Claude Code Remote server`)
          return
        }
        // Fall through to standard processing if webhook not configured or failed
      }

      // Check if this is an internal agent
      const isInternalAgent = task.assignee.email?.endsWith('@astrid.cc')
      const { isCodingAgent } = await import('@/lib/ai-agent-utils')

      if (isInternalAgent) {
        // Find first list with a repository (task may be in multiple lists)
        const repository = task.lists?.find(l => l.githubRepositoryId)?.githubRepositoryId

        if (repository && isCodingAgent(task.assignee)) {
          console.log(`🤖 Internal coding agent - triggering tools workflow for comment response`)

          // Trigger tools-based workflow to handle the user's comment
          try {
            const baseUrl = getBaseUrl()
            await fetch(`${baseUrl}/api/coding-workflow/start-tools-workflow`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: task.id,
                repository,
                userComment: commentContent // Pass user's comment as context
              })
            })
            console.log(`✅ Tools workflow triggered for comment: "${commentContent}"`)
          } catch (error) {
            console.error(`❌ Failed to trigger tools workflow:`, error)
          }
        } else {
          console.log(`🤖 Internal assistant agent - triggering real-time workflow for comment response`)

          // Non-coding task: trigger assistant workflow for comment response
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
                userComment: commentContent
              })
            })

            if (response.ok) {
              console.log(`✅ Assistant workflow triggered for comment: "${commentContent}"`)
            } else {
              const error = await response.text()
              console.error(`❌ Assistant workflow failed: ${error}`)
            }
          } catch (error) {
            console.error(`❌ Failed to trigger assistant workflow:`, error)
          }
        }
        return
      }

      // Send webhook notification for external agents only
      if (task.assignee.webhookUrl) {
        await this.sendWebhookNotification(task.assignee.webhookUrl, payload)
      }

      console.log(`✅ Successfully notified AI agent ${task.assignee.name} about comment`)

    } catch (error) {
      console.error(`❌ Failed to notify AI agent about comment:`, error)
      throw error
    }
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