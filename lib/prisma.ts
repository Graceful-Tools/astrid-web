import { BRAND } from '@/lib/brand/config'
import { UNKNOWN_CREATOR_EMAIL } from '@/lib/brand/agent-emails'
import { Prisma, PrismaClient } from "@prisma/client"
import { createLogger } from '@/lib/logger'

const log = createLogger('prisma')


const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Track task assignee changes for AI agent webhook triggering
// This runs AFTER the database update to capture the change
async function handleTaskAssigneeChange(
  taskId: string,
  previousAssigneeId: string | null,
  newAssigneeId: string
) {
  // Only proceed if assignee actually changed TO someone (not unassignment)
  if (newAssigneeId === previousAssigneeId) {
    return
  }

  log.info(`🔔 [PRISMA-MIDDLEWARE] Task ${taskId} assignee changed: ${previousAssigneeId} → ${newAssigneeId}`)

  try {
    // Dynamic import to avoid circular dependencies
    const { isCodingAgent } = await import('@/lib/ai-agent-utils')
    const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
    const { getBaseUrl, getTaskUrl } = await import('@/lib/base-url')

    // Create a fresh prisma client for this query to avoid middleware recursion
    const queryClient = new PrismaClient()

    try {
      // Check if new assignee is a coding agent
      const assignee = await queryClient.user.findUnique({
        where: { id: newAssigneeId },
        select: { id: true, name: true, email: true, isAIAgent: true, aiAgentType: true }
      })

      if (!assignee || !isCodingAgent(assignee)) {
        log.info(`📋 [PRISMA-MIDDLEWARE] Assignee ${newAssigneeId} is not a coding agent, skipping webhook`)
        return
      }

      log.info(`🤖 [PRISMA-MIDDLEWARE] Coding agent detected: ${assignee.name}`)

      // Get full task data for webhook
      const task = await queryClient.task.findUnique({
        where: { id: taskId },
        include: {
          creator: { select: { id: true, name: true, email: true } },
          assignee: { select: { id: true, name: true, email: true, isAIAgent: true, aiAgentType: true } },
          lists: { select: { id: true, name: true, description: true, githubRepositoryId: true, ownerId: true, aiAgentConfiguredBy: true } }
        }
      })

      if (!task) {
        log.error(`❌ [PRISMA-MIDDLEWARE] Task ${taskId} not found after update`)
        return
      }

      // Check if we already posted a "starting" comment recently (within last 5 minutes)
      // This prevents duplicate comments when the middleware is triggered multiple times
      const recentStartingComment = await queryClient.comment.findFirst({
        where: {
          taskId: task.id,
          authorId: assignee.id,
          content: { contains: 'starting' },
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }
        },
        orderBy: { createdAt: 'desc' }
      })

      if (recentStartingComment) {
        log.info(`📋 [PRISMA-MIDDLEWARE] Starting comment already posted recently, skipping duplicate`)
      } else {
        // Post acknowledgment comment
        await queryClient.comment.create({
          data: {
            taskId: task.id,
            authorId: assignee.id,
            content: `🤖 **${assignee.name} starting**\n\nAnalyzing → Implementing → Deploying\n\nWill post updates at key milestones.`,
            type: 'MARKDOWN'
          }
        })
        log.info(`✅ [PRISMA-MIDDLEWARE] Posted acknowledgment comment`)
      }

      // Send webhook to user's Claude Code Remote server
      const baseUrl = getBaseUrl()
      const firstList = task.lists?.[0]

      const webhookPayload = {
        event: 'task.assigned' as const,
        timestamp: new Date().toISOString(),
        aiAgent: {
          id: assignee.id,
          name: assignee.name || 'Claude Agent',
          type: assignee.aiAgentType || 'claude_agent',
          email: assignee.email,
        },
        task: {
          id: task.id,
          title: task.title,
          description: task.description || '',
          priority: task.priority,
          dueDateTime: task.dueDateTime?.toISOString(),
          assigneeId: assignee.id,
          creatorId: task.creatorId,
          listId: firstList?.id || '',
          url: getTaskUrl(task.id),
        },
        list: {
          id: firstList?.id || '',
          name: firstList?.name || 'Default',
          githubRepositoryId: firstList?.githubRepositoryId || undefined,
        },
        mcp: {
          baseUrl,
          operationsEndpoint: `${baseUrl}/api/mcp/operations`,
          availableOperations: ['task.read', 'task.update', 'task.comment'],
          contextInstructions: `Use the ${BRAND.appName} MCP server to interact with tasks.`,
        },
        creator: {
          id: task.creatorId,
          name: task.creator?.name || undefined,
          email: task.creator?.email || UNKNOWN_CREATOR_EMAIL,
        },
      }

      // Fall back to list owner when creatorId is null
      const webhookUserId = task.creatorId || firstList?.ownerId
      if (!webhookUserId) {
        log.info(`📋 [PRISMA-MIDDLEWARE] Task has no creatorId or list owner, skipping webhook`)
        return
      }

      log.info(`🚀 [PRISMA-MIDDLEWARE] Sending webhook for task ${taskId} to user ${webhookUserId} (creator: ${task.creatorId}, listOwner: ${firstList?.ownerId})`)
      const webhookResult = await aiAgentWebhookService.sendToUserWebhook(
        webhookUserId,
        'task.assigned',
        webhookPayload
      )

      if (webhookResult.sent) {
        log.info(`✅ [PRISMA-MIDDLEWARE] Webhook sent successfully`)
      } else {
        // No webhook configured - check if this is a non-git task that needs assistant workflow
        const hasGitRepo = task.lists?.some(l => l.githubRepositoryId)

        if (!hasGitRepo) {
          // Non-git task: trigger assistant workflow via API route (runs in its own request context)
          log.info(`📝 [PRISMA-MIDDLEWARE] No git repo, triggering assistant workflow API for task ${taskId}`)

          const configuredByUserId = firstList?.aiAgentConfiguredBy || task.creatorId || firstList?.ownerId

          if (configuredByUserId) {
            // Call the workflow directly. It used to be reached by fetching this
            // app's own /api/assistant-workflow — which is why that route had no
            // authentication and worked for anyone who found the URL (task
            // 12b3478d). Dynamic import because the workflow imports this module.
            log.info(`🚀 [PRISMA-MIDDLEWARE] Running assistant workflow for task ${taskId}`)
            try {
              const { runAssistantWorkflow } = await import('@/lib/assistant-workflow/run-assistant-workflow')
              const result = await runAssistantWorkflow({
                taskId: task.id,
                agentEmail: assignee.email,
                creatorId: configuredByUserId,
                isCommentResponse: false,
              })

              if (result.ok) {
                log.info({ result }, `✅ [PRISMA-MIDDLEWARE] Assistant workflow completed:`)
              } else {
                log.error(`❌ [PRISMA-MIDDLEWARE] Assistant workflow failed: ${result.error}`)
              }
            } catch (err) {
              log.error({ err: err }, `❌ [PRISMA-MIDDLEWARE] Failed to run assistant workflow:`)
            }
          } else {
            log.info(`⚠️ [PRISMA-MIDDLEWARE] No user ID available to get API keys for assistant workflow`)
          }
        } else {
          // Git repo task: polling worker will handle this
          log.info(`📋 [PRISMA-MIDDLEWARE] Task has git repo, polling worker will handle`)
        }
      }
    } finally {
      await queryClient.$disconnect()
    }
  } catch (error) {
    log.error({ err: error }, `❌ [PRISMA-MIDDLEWARE] Error handling assignee change:`)
  }
}

// During build time, provide a mock Prisma client if DATABASE_URL is not available
// This prevents build failures while maintaining type safety
const createPrismaClient = () => {
  if (process.env.DATABASE_URL) {
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      errorFormat: "pretty",
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
      transactionOptions: {
        timeout: 10000,
        maxWait: 5000,
      },
    })

    // Extend with AI agent webhook middleware using Prisma 6.x $extends
    return client.$extends({
      query: {
        task: {
          async update({ args, query }) {
            const taskId = args.where?.id
            const newAssigneeId = args.data?.assigneeId

            // If no taskId or no assigneeId change, just run the query
            if (!taskId || newAssigneeId === undefined) {
              return query(args)
            }

            // Get the current assignee BEFORE the update
            let previousAssigneeId: string | null = null
            try {
              const existingTask = await client.task.findUnique({
                where: { id: taskId },
                select: { assigneeId: true }
              })
              previousAssigneeId = existingTask?.assigneeId ?? null
            } catch {
              // Ignore errors getting previous state
            }

            // Execute the actual update
            const result = await query(args)

            // After update, check if we need to trigger webhook (async, don't await)
            // Only trigger if assigneeId is a string (not null/undefined) and changed
            if (typeof newAssigneeId === 'string' && newAssigneeId !== previousAssigneeId) {
              // Fire and forget - don't block the response
              handleTaskAssigneeChange(taskId, previousAssigneeId, newAssigneeId).catch(err => {
                log.error({ err: err }, `❌ [PRISMA-MIDDLEWARE] Webhook handler error:`)
              })
            }

            return result
          }
        }
      }
    }) as unknown as PrismaClient
  }

  // During build time, return a mock client that throws runtime errors
  // This allows static analysis to pass while preventing actual database calls during build
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    log.warn("⚠️  DATABASE_URL not available during build - using mock Prisma client")
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error("Database not available - DATABASE_URL not configured")
      }
    })
  }

  throw new Error("Database connection not available. Make sure DATABASE_URL is set.")
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production" && prisma) {
  globalForPrisma.prisma = prisma
}

// Graceful shutdown
process.on("beforeExit", async () => {
  if (prisma && process.env.DATABASE_URL) {
    await prisma.$disconnect()
  }
})
