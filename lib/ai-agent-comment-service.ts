/**
 * AI Agent Comment Service
 * Provides a way for AI agents to create comments through the proper MVC architecture
 * instead of bypassing the controller with direct database calls.
 */

import { prisma } from './prisma'
import { broadcastToUsers } from './sse-utils'

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
      const targetEmail = task.aiAgent.service === 'openai'
        ? 'openai@astrid.cc'
        : task.aiAgent.service === 'claude'
          ? 'claude@astrid.cc'
          : task.aiAgent.service === 'gemini'
            ? 'gemini@astrid.cc'
            : task.aiAgent.service === 'openclaw'
              ? 'openclaw@astrid.cc'
              : null

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
        const emailMap: Record<string, string> = {
          'claude': 'claude@astrid.cc',
          'openai': 'openai@astrid.cc',
          'gemini': 'gemini@astrid.cc'
        }
        const targetEmail = emailMap[workflow.aiService]

        if (targetEmail) {
          const agentByEmail = await prisma.user.findUnique({
            where: { email: targetEmail }
          })

          if (agentByEmail?.isAIAgent) {
            agentUser = agentByEmail
            console.log(`[AI Agent Comment] Found agent from workflow: ${targetEmail}`)
          }
        }
      }
    }

    if (!agentUser) {
      console.error(`[AI Agent Comment] Unable to resolve AI agent user for task ${taskId}`)
      return { success: false, error: 'AI agent user not found for task' }
    }

    const agentUserId = agentUser.id
    const agentDisplayName = agentUser.name || (task.aiAgent?.name ?? 'AI Agent')

    // Create the comment with proper relations
    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        type,
        taskId,
        authorId: agentUserId
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: {
            author: true,
            secureFiles: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    // SSE Broadcasting - follow the same logic as the comment controller
    try {
      // Collect all users who should be notified (same logic as comment controller)
      const userIds = new Set<string>()

      // Add task assignee (if not AI agent)
      if (task.assigneeId && task.assigneeId !== agentUserId) {
        userIds.add(task.assigneeId)
      }

      // Add task creator (if not AI agent)
      if (task.creatorId && task.creatorId !== agentUserId) {
        userIds.add(task.creatorId)
      }

      // Add all list members
      task.lists.forEach(list => {
        // Add list owner
        if (list.ownerId && list.ownerId !== agentUserId) {
          userIds.add(list.ownerId)
        }

        // Add members from listMembers relation
        list.listMembers?.forEach(listMember => {
          if (listMember.user.id !== agentUserId) {
            userIds.add(listMember.user.id)
          }
        })
      })

      // Broadcast to all relevant users (same format as comment controller)
      if (userIds.size > 0) {
        console.log('🤖 Broadcasting AI agent comment to users:', Array.from(userIds))
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_created',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            commentId: comment.id,
            commentContent: comment.content.substring(0, 100), // First 100 chars for preview
            commenterName: agentDisplayName,
            userId: agentUserId,
            listNames: task.lists.map(list => list.name),
            comment: {
              id: comment.id,
              content: comment.content,
              type: comment.type,
              author: comment.author,
              createdAt: comment.createdAt,
              parentCommentId: comment.parentCommentId
            }
          }
        })
      }
    } catch (sseError) {
      console.error("Failed to send AI agent comment SSE notifications:", sseError)
      // Continue - comment was still created
    }

    // Note: We skip workflow action processing for AI agent comments to prevent infinite loops
    // The isCommenterAIAgent check in the comment controller would prevent this anyway

    console.log('✅ AI agent comment created successfully with SSE broadcasting')
    return { success: true, comment }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('❌ AI agent comment service error:', errorMessage)
    return { success: false, error: errorMessage }
  }
}
