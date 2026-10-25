/**
 * AI Agent Comment Service
 * Provides a way for AI agents to create comments through the proper MVC architecture
 * instead of bypassing the controller with direct database calls.
 */

import { agentEmailForService } from '@/lib/ai/agent-config'
import { prisma } from './prisma'
import { postCommentAs } from '@/services/post-comment-as'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-agent-comment-service')


export interface AIAgentCommentData {
  content: string
  type?: 'TEXT' | 'MARKDOWN'
  parentCommentId?: string
}

/**
 * Create a comment as the AI agent using the proper business logic
 * This ensures SSE broadcasting and follows the same patterns as the API controller
 */
export async function createAIAgentComment(
  taskId: string,
  content: string,
  type: 'TEXT' | 'MARKDOWN' = 'MARKDOWN'
): Promise<{ success: boolean; error?: string; comment?: any }> {
  try {
    // Get task with all list relationships to ensure access and for SSE broadcasting
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true,
        aiAgent: true,
        creator: true,
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            }
          }
        }
      }
    })

    if (!task) {
      return { success: false, error: 'Task not found' }
    }

    // Resolve the correct AI agent user dynamically instead of relying on a hard-coded id
    let agentUser = task.assignee && task.assignee.isAIAgent ? task.assignee : null

    if (!agentUser && task.assigneeId) {
      const assigneeRecord = await prisma.user.findUnique({
        where: { id: task.assigneeId }
      })
      if (assigneeRecord?.isAIAgent) {
        agentUser = assigneeRecord
      }
    }

    if (!agentUser && task.assignee?.email) {
      const emailMatch = await prisma.user.findUnique({
        where: { email: task.assignee.email }
      })
      if (emailMatch?.isAIAgent) {
        agentUser = emailMatch
      }
    }

    if (!agentUser && task.aiAgent) {
      const targetEmail = agentEmailForService(task.aiAgent.service)

      if (targetEmail) {
        const agentByEmail = await prisma.user.findUnique({
          where: { email: targetEmail }
        })

        if (agentByEmail?.isAIAgent) {
          agentUser = agentByEmail
        }
      }

      if (!agentUser) {
        const targetAgentType = task.aiAgent.service === 'openai'
          ? 'openai_agent'
          : task.aiAgent.service === 'claude'
            ? 'claude_agent'
            : task.aiAgent.service === 'gemini'
              ? 'gemini_agent'
              : task.aiAgent.service === 'copilot'
                ? 'copilot_agent'
                : undefined

        if (targetAgentType) {
          const agentByType = await prisma.user.findFirst({
            where: {
              isAIAgent: true,
              aiAgentType: targetAgentType
            },
            orderBy: {
              updatedAt: 'desc'
            }
          })

          if (agentByType) {
            agentUser = agentByType
          }
        }
      }
    }

    // Last fallback: check the coding workflow for which AI service was used
    if (!agentUser) {
      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { taskId }
      })

      if (workflow?.aiService) {
        const targetEmail = agentEmailForService(workflow.aiService)

        if (targetEmail) {
          const agentByEmail = await prisma.user.findUnique({
            where: { email: targetEmail }
          })

          if (agentByEmail?.isAIAgent) {
            agentUser = agentByEmail
            log.info(`[AI Agent Comment] Found agent from workflow: ${targetEmail}`)
          }
        }
      }
    }

    if (!agentUser) {
      log.error(`[AI Agent Comment] Unable to resolve AI agent user for task ${taskId}`)
      return { success: false, error: 'AI agent user not found for task' }
    }

    // Through the comment service: list broadcast, notifications, mention
    // pushes — the same as any comment. This used to insert the row and hand-
    // roll its own SSE fan-out (P1 step 4). Agent-authored comments do not
    // re-wake agents; the service's side effects skip that for AI commenters.
    const posted = await postCommentAs({ taskId, authorId: agentUser.id, content: content.trim(), type })
    if (!posted.ok) return { success: false, error: posted.error }

    log.info('✅ AI agent comment created')
    return { success: true, comment: posted.comment }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error({ err: errorMessage }, '❌ AI agent comment service error:')
    return { success: false, error: errorMessage }
  }
}
