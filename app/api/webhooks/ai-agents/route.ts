import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { aiAgentWebhookService } from "@/lib/ai-agent-webhook-service"
import { broadcastToUsers } from "@/lib/sse-utils"
import { RATE_LIMITS, withRateLimitAsync } from "@/lib/rate-limiter"
import { z } from "zod"
import { createLogger } from '@/lib/logger'

const log = createLogger('api.webhooks.ai-agents')


// Webhook payload schema for incoming requests
const IncomingWebhookSchema = z.object({
  event: z.enum(['task.completed', 'task.progress', 'task.comment', 'task.error']),
  timestamp: z.string(),
  aiAgent: z.object({
    id: z.string(),
    type: z.string()
  }),
  task: z.object({
    id: z.string(),
    completed: z.boolean().optional(),
    progress: z.string().optional(),
    comment: z.string().optional(),
    error: z.string().optional()
  }),
  accessToken: z.string()
})

/**
 * Ensures an AI agent user exists in the database
 * If not found, creates a new AI agent user record
 * Returns a valid user ID for comment creation
 */
async function ensureAIAgentExists(aiAgent: { id: string, type: string }): Promise<string> {
  try {
    // First, check if the AI agent user already exists
    const existingAgent = await prisma.user.findUnique({
      where: { id: aiAgent.id },
      select: { id: true }
    })

    if (existingAgent) {
      log.info(`✅ [AI Agent] Found existing agent: ${aiAgent.id}`)
      return aiAgent.id
    }

    // Create new AI agent user if not found
    log.info(`🔧 [AI Agent] Creating new agent user: ${aiAgent.id}`)
    const newAgent = await prisma.user.create({
      data: {
        id: aiAgent.id,
        name: `AI Agent (${aiAgent.type})`,
        email: `${aiAgent.id}@astrid.internal`,
        isAIAgent: true,
        aiAgentType: aiAgent.type === 'claude_agent' ? 'claude_agent' : 'coding_agent',
        webhookUrl: `https://${BRAND.domain}/api/webhooks/ai-agents`,
        isActive: true
      }
    })

    log.info(`✅ [AI Agent] Created new agent: ${newAgent.id}`)
    return newAgent.id

  } catch (error) {
    log.error({ err: error }, '⚠️ [AI Agent] Failed to ensure agent exists:')

    // Fallback: try to find any AI agent user to use as author
    const fallbackAgent = await prisma.user.findFirst({
      where: { isAIAgent: true, isActive: true },
      select: { id: true }
    })

    if (fallbackAgent) {
      log.info(`🔄 [AI Agent] Using fallback agent: ${fallbackAgent.id}`)
      return fallbackAgent.id
    }

    // Last resort: throw error if no AI agent can be found
    throw new Error(`Failed to ensure AI agent exists: ${error}`)
  }
}

async function sendAIAgentActivitySSE(task: any, payload: any, aiAgent: any) {
  try {
    // Get task with related data for notification
    const taskWithLists = await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        lists: {
          include: {
            owner: { select: { id: true } },
            listMembers: {
              include: { user: { select: { id: true } } }
            }
          }
        }
      }
    })

    if (!taskWithLists) return

    // Get all users who should be notified
    const notifyUserIds = new Set<string>()

    // Add task creator
    if (taskWithLists.creator?.id) {
      notifyUserIds.add(taskWithLists.creator.id)
    }

    // Add list members
    for (const list of taskWithLists.lists) {
      if (list.ownerId) notifyUserIds.add(list.ownerId)
      list.listMembers.forEach(listMember => notifyUserIds.add(listMember.user.id))
    }

    // Remove AI agent from notifications
    notifyUserIds.delete(aiAgent.id)

    const userIdsArray = Array.from(notifyUserIds)
    if (userIdsArray.length > 0) {
      broadcastToUsers(userIdsArray, {
        type: 'ai_agent_activity',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          aiAgentName: aiAgent.name,
          aiAgentType: aiAgent.aiAgentType,
          event: payload.event,
          completed: payload.task.completed,
          progress: payload.task.progress,
          comment: payload.task.comment,
          error: payload.task.error,
          listNames: taskWithLists.lists?.map(list => list.name) || []
        }
      })

      log.info(`📡 Sent SSE notification about AI agent activity to ${userIdsArray.length} users`)
    }
  } catch (error) {
    log.error({
      taskId: payload.task.id,
      aiAgentId: aiAgent?.id,
      aiAgentType: aiAgent?.aiAgentType,
      event: payload.event,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, '❌ Failed to send AI agent activity SSE:')
  }
}

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitCheck = await withRateLimitAsync(RATE_LIMITS.WEBHOOK)(request)

  if (!rateLimitCheck.allowed) {
    log.info(rateLimitCheck.error, '🚫 Webhook rate limited:')
    return NextResponse.json(
      rateLimitCheck.error,
      {
        status: 429,
        headers: rateLimitCheck.headers
      }
    )
  }

  try {
    log.info('🔔 Received AI agent webhook')

    const body = await request.json()
    const payload = IncomingWebhookSchema.parse(body)

    // Validate access token
    const mcpToken = await prisma.mCPToken.findFirst({
      where: {
        token: payload.accessToken,
        isActive: true,
        user: {
          isAIAgent: true,
          id: payload.aiAgent.id
        }
      },
      include: {
        user: true
      }
    })

    if (!mcpToken) {
      log.info('❌ Invalid access token or AI agent')
      return NextResponse.json({ error: 'Invalid access token' }, { status: 401 })
    }

    // Verify task exists and is assigned to this AI agent
    const task = await prisma.task.findFirst({
      where: {
        id: payload.task.id,
        assigneeId: payload.aiAgent.id
      }
    })

    if (!task) {
      log.info('❌ Task not found or not assigned to this AI agent')
      return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 })
    }

    log.info(`📝 Processing ${payload.event} for task ${task.title} from ${mcpToken.user.name}`)

    // Handle different event types
    switch (payload.event) {
      case 'task.completed':
        if (payload.task.completed) {
          await prisma.task.update({
            where: { id: task.id },
            data: { completed: true }
          })
          log.info(`✅ Task marked as completed: ${task.title}`)
        }
        break

      case 'task.progress':
      case 'task.comment':
        if (payload.task.comment || payload.task.progress) {
          const commentContent = payload.task.progress
            ? `Progress Update: ${payload.task.progress}`
            : payload.task.comment!

          const validAuthorId = await ensureAIAgentExists(payload.aiAgent)

          await prisma.comment.create({
            data: {
              content: commentContent,
              type: 'TEXT',
              authorId: validAuthorId,
              taskId: task.id
            }
          })
          log.info(`💬 Comment added to task: ${task.title}`)
        }
        break

      case 'task.error':
        if (payload.task.error) {
          const validAuthorId = await ensureAIAgentExists(payload.aiAgent)

          await prisma.comment.create({
            data: {
              content: `❌ Error: ${payload.task.error}`,
              type: 'TEXT',
              authorId: validAuthorId,
              taskId: task.id
            }
          })
          log.info(`⚠️ Error logged for task: ${task.title}`)
        }
        break
    }

    // Send SSE notification to relevant users about AI agent activity
    await sendAIAgentActivitySSE(task, payload, mcpToken.user)

    return NextResponse.json({
      success: true,
      message: `Event ${payload.event} processed successfully`
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      log.info(error.errors, '❌ Invalid webhook payload:')
      return NextResponse.json({
        error: 'Invalid payload',
        details: error.errors
      }, { status: 400 })
    }

    log.error({ err: error }, '❌ Error processing AI agent webhook:')
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}

// Handle GET requests to provide webhook documentation
export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin

  return NextResponse.json({
    name: `${BRAND.appName} AI Agent Webhook Endpoint`,
    description: 'Receives updates from AI agents about task progress and completion',
    endpoint: `${baseUrl}/api/webhooks/ai-agents`,
    method: 'POST',
    authentication: 'Bearer token in payload.accessToken',
    supportedEvents: [
      'task.completed',
      'task.progress',
      'task.comment',
      'task.error'
    ],
    payloadSchema: {
      event: 'string (enum)',
      timestamp: 'string (ISO 8601)',
      aiAgent: {
        id: 'string (AI agent user ID)',
        type: 'string (claude|astrid|gemini|openai)'
      },
      task: {
        id: 'string (task ID)',
        completed: 'boolean (optional)',
        progress: 'string (optional)',
        comment: 'string (optional)',
        error: 'string (optional)'
      },
      accessToken: 'string (MCP access token)'
    },
    examples: {
      taskCompleted: {
        event: 'task.completed',
        timestamp: new Date().toISOString(),
        aiAgent: { id: 'agent-123', type: 'claude' },
        task: { id: 'task-456', completed: true },
        accessToken: 'ai-agent-token-123'
      },
      taskProgress: {
        event: 'task.progress',
        timestamp: new Date().toISOString(),
        aiAgent: { id: 'agent-123', type: 'claude' },
        task: { id: 'task-456', progress: 'Halfway complete, working on implementation' },
        accessToken: 'ai-agent-token-123'
      }
    }
  })
}