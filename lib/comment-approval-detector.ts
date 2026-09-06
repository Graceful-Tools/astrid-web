/**
 * Enhanced comment action detection for coding workflows
 * Monitors task comments for multiple action types: approve, merge, change requests
 */

import { prisma } from './prisma'
import { createAIAgentComment } from './ai-agent-comment-service'
import {
  getAgentExecutionMode,
  resolveAgentRunOwnerId,
  shouldPostServerWorkflowComments,
} from '@/lib/ai/agent-execution-mode'
import { createLogger } from '@/lib/logger'

const log = createLogger('comment-approval-detector')



export type CommentAction =
  | { type: 'approve'; confidence: number }
  | { type: 'merge'; confidence: number }
  | { type: 'changes_requested'; confidence: number; feedback?: string }
  | { type: 'none'; confidence: 0 }

/**
 * Does this task use Astrid's built-in server workflow?
 *
 * Reads the assignee and the owner in one query so the four trigger paths share
 * one answer. A task whose assignee cannot be read is treated as server-managed —
 * that would silently disable server-side workflows on a bad query, which is the
 * failure mode this whole detector exists to avoid.
 */
async function usesServerWorkflow(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assignee: { select: { email: true } },
      lists: {
        select: { ownerId: true, aiAgentConfiguredBy: true },
        take: 1,
      },
    },
  })

  if (!task?.assignee?.email) return true

  const mode = await getAgentExecutionMode(
    resolveAgentRunOwnerId({
      aiAgentConfiguredBy: task.lists[0]?.aiAgentConfiguredBy,
      creatorId: task.creatorId,
      listOwnerId: task.lists[0]?.ownerId,
    }),
    task.assignee.email,
  )
  return shouldPostServerWorkflowComments(mode)
}

/**
 * Detect the action type from comment content
 */
export function detectCommentAction(content: string): CommentAction {
  const normalizedContent = content.toLowerCase().trim()

  // Check for change request keywords
  const changeRequestKeywords = [
    'change', 'fix', 'update', 'modify', 'revise', 'adjust', 'improve',
    'please change', 'can you', 'could you', 'needs work', 'not quite',
    'almost there', 'few issues', 'small changes', 'minor fixes',
    'request changes', 'changes needed', 'please update'
  ]

  const changeRequestScore = changeRequestKeywords.reduce((score, keyword) =>
    normalizedContent.includes(keyword) ? score + 1 : score, 0
  )

  // Check for approval keywords
  const approvalKeywords = [
    'approve', 'approved', 'lgtm', 'looks good', 'go ahead', 'proceed',
    'yes', 'perfect', 'excellent', 'great work', 'well done', 'good to go',
    'ready', 'ship', 'deploy'
  ]

  const approvalScore = approvalKeywords.reduce((score, keyword) =>
    normalizedContent.includes(keyword) ? score + 1 : score, 0
  )

  // Check for merge keywords (stronger than approval)
  const mergeKeywords = [
    'merge', 'ship it', 'deploy', 'ready to merge', 'merge it',
    'looks good to merge', 'ship this', 'go live', 'publish'
  ]

  const mergeScore = mergeKeywords.reduce((score, keyword) =>
    normalizedContent.includes(keyword) ? score + 1 : score, 0
  )

  // Determine action based on scores and context
  if (mergeScore > 0) {
    return { type: 'merge', confidence: Math.min(mergeScore * 0.3, 1) }
  }

  if (changeRequestScore > approvalScore && changeRequestScore > 0) {
    // Extract feedback by looking for sentences that contain concerns
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)
    const feedbackSentences = sentences.filter(sentence => {
      const lower = sentence.toLowerCase()
      return changeRequestKeywords.some(keyword => lower.includes(keyword))
    })

    return {
      type: 'changes_requested',
      confidence: Math.min(changeRequestScore * 0.25, 1),
      feedback: feedbackSentences.join('. ')
    }
  }

  if (approvalScore > 0) {
    return { type: 'approve', confidence: Math.min(approvalScore * 0.3, 1) }
  }

  return { type: 'none', confidence: 0 }
}

/**
 * Process a new comment to check for any workflow actions
 */
export async function processCommentForWorkflowAction(
  taskId: string,
  commentId: string,
  content: string,
  authorId: string
): Promise<void> {
  try {
    // Every branch below belongs to Astrid's built-in API workflow. Polling,
    // webhook, and disabled agents own their responses elsewhere.
    if (!(await usesServerWorkflow(taskId))) {
      log.info(`💻 [CommentAction] ${taskId} is not server-managed — leaving responses to its runtime`)
      return
    }

    // Check if this task has an active coding workflow
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    if (!workflow) {
      // No workflow record - check if task has AI agent and failure markers in comments
      // This handles older tasks that were processed before workflow records were created
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignee: true,
          creator: true,
          comments: {
            orderBy: { createdAt: 'desc' },
            take: 20
          }
        }
      })

      if (!task) return

      // Check if assigned to AI agent
      if (!task.assignee?.isAIAgent) return

      // Check if there are failure markers in recent comments
      const hasFailureMarker = task.comments?.some(c =>
        c.content.includes('Workflow Failed') ||
        c.content.includes('❌ **Error**') ||
        c.content.includes('Planning produced no files')
      )

      if (hasFailureMarker && task.creatorId === authorId) {
        log.info(`🔄 [CommentAction] No workflow record but task has failure markers - treating as retry feedback`)

        // Create a workflow record with FAILED status so retry logic can work
        const newWorkflow = await prisma.codingTaskWorkflow.create({
          data: {
            taskId,
            status: 'FAILED',
            aiService: task.assignee.email?.includes('openai') ? 'openai'
              : task.assignee.email?.includes('gemini') ? 'gemini'
              : task.assignee.email?.includes('copilot') ? 'copilot'
              : 'claude',
            metadata: {
              error: 'Previous failure (no workflow record)',
              createdForRetry: true,
              timestamp: new Date().toISOString()
            }
          }
        })

        await triggerRetryWithFeedback(newWorkflow.id, commentId, taskId, content)
        return
      }

      // No failure markers or not authorized - nothing to do
      return
    }

    // Check if the commenter is authorized (task creator)
    if (authorId !== workflow.task.creatorId) {
      // Only task creator can trigger actions
      return
    }

    // IMPORTANT: Check for FAILED status FIRST - any comment on a failed workflow triggers retry
    // This must come before action detection because users may not use specific keywords
    if (workflow.status === 'FAILED') {
      log.info(`🔄 [CommentAction] Workflow is FAILED - treating comment as retry feedback`)
      await triggerRetryWithFeedback(workflow.id, commentId, taskId, content)
      return
    }

    // Detect the action from the comment
    const action = detectCommentAction(content)

    if (action.type === 'none' || action.confidence < 0.2) {
      // Not a clear action comment
      return
    }

    log.info({
      taskId,
      commentId,
      workflowId: workflow.id,
      author: authorId,
      confidence: action.confidence,
      currentStatus: workflow.status
    }, `🎯 [CommentAction] Detected ${action.type} action:`)

    // Handle action based on workflow status and action type
    if (action.type === 'approve' && workflow.status === 'AWAITING_APPROVAL') {
      await triggerPlanApproval(workflow.id, commentId, taskId)
    } else if (action.type === 'merge' && workflow.status === 'TESTING') {
      await triggerMergeRequest(workflow.id, commentId, taskId)
    } else if (action.type === 'changes_requested') {
      await triggerChangeRequest(workflow.id, commentId, taskId, action.feedback || content)
    } else {
      log.info(`⚠️ [CommentAction] Action ${action.type} not applicable for status ${workflow.status}`)
    }

  } catch (error) {
    log.error({ err: error }, '❌ [CommentAction] Error processing comment for workflow action:')
  }
}

/**
 * Check for merge request keywords
 */
export async function processCommentForMergeRequest(
  taskId: string,
  commentId: string,
  content: string,
  authorId: string
): Promise<void> {
  try {
    // Check if this task has an active coding workflow ready for merge
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    if (!workflow) {
      return
    }

    if (workflow.status !== 'TESTING') {
      return
    }

    // Check if the commenter is authorized (task creator)
    if (authorId !== workflow.task.creatorId) {
      return
    }

    // Check for merge keywords
    const normalizedContent = content.toLowerCase().trim()
    const mergeKeywords = [
      'merge',
      'ship it',
      'deploy',
      'ready to merge',
      'merge it',
      'looks good to merge',
      'ship'
    ]

    const isMergeRequest = mergeKeywords.some(keyword =>
      normalizedContent.includes(keyword)
    )

    if (!isMergeRequest) {
      return
    }

    log.info({
      taskId,
      commentId,
      workflowId: workflow.id,
      author: authorId
    }, '🔀 [CommentApproval] Detected merge request in comment:')

    // Trigger merge request
    await triggerMergeRequest(workflow.id, commentId, taskId)

  } catch (error) {
    log.error({ err: error }, '❌ [CommentApproval] Error processing comment for merge:')
  }
}

/**
 * Trigger plan approval directly
 */
async function triggerPlanApproval(workflowId: string, commentId: string, taskId: string): Promise<void> {
  try {
    // Get the task and its AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    // Only create acknowledgment if task has an AI assignee
    if (task?.assignee?.isAIAgent) {
      // Post acknowledgment comment using the new AI agent service
      const result = await createAIAgentComment(
        taskId,
        `✅ **Approval Received**\n\nThanks! Starting implementation now...\n\n*This is an automated response to your approval*\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post approval acknowledgment comment:')
      }
    }

    // Get workflow to find task creator
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: {
          include: { creator: true }
        }
      }
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Create orchestrator and handle approval
    const { AIOrchestrator } = await import('./ai-orchestrator')
    if (!workflow.task.creatorId) {
      throw new Error('Task creator no longer exists (deleted account)')
    }
    const orchestrator = await AIOrchestrator.createForTask(taskId, workflow.task.creatorId)
    await orchestrator.handlePlanApproval(workflowId, commentId)

    log.info('✅ [CommentApproval] Plan approval triggered successfully')

  } catch (error) {
    log.error({ err: error }, '❌ [CommentApproval] Failed to trigger plan approval:')

    // Post error comment using the actual AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      const result = await createAIAgentComment(
        taskId,
        `❌ **Approval Processing Error**\n\nI encountered an issue starting the implementation:\n\n**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\nLet me investigate and try again, or feel free to re-approve if needed.\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post approval error comment:')
      }
    }
  }
}

/**
 * Trigger merge request directly
 */
async function triggerMergeRequest(workflowId: string, commentId: string, taskId: string): Promise<void> {
  try {
    // Get the task and its AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    // Only create acknowledgment if task has an AI assignee
    if (task?.assignee?.isAIAgent) {
      // Post acknowledgment comment using the new AI agent service
      const result = await createAIAgentComment(
        taskId,
        `🚀 **Shipping to Production**\n\nDeploying your approved changes to production now!\n\n*This is an automated response to your ship command*\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post merge acknowledgment comment:')
      }
    }

    // TODO: Implement actual merge/deployment logic
    // This would typically:
    // 1. Merge the GitHub PR
    // 2. Deploy to production
    // 3. Mark workflow as complete
    // 4. Update task status

    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'COMPLETED',
        metadata: {
          mergedAt: new Date().toISOString(),
          mergedBy: commentId
        }
      }
    })

    // Mark task as complete
    await prisma.task.update({
      where: { id: taskId },
      data: { completed: true }
    })

    log.info('🔀 [CommentApproval] Merge request triggered successfully')

  } catch (error) {
    log.error({ err: error }, '❌ [CommentApproval] Failed to trigger merge request:')

    // Post error comment using the actual AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      const result = await createAIAgentComment(
        taskId,
        `❌ **Deployment Error**\n\nI encountered an issue deploying to production:\n\n**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\nLet me investigate this issue. The code is ready but deployment failed.\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post deployment error comment:')
      }
    }
  }
}

/**
 * Trigger change request handling directly
 */
async function triggerChangeRequest(
  workflowId: string,
  commentId: string,
  taskId: string,
  feedback: string
): Promise<void> {
  try {
    // Extract the actual change request (remove action prefixes)
    const changeRequest = feedback.replace(/^(change|fix|update|modify)\s+/i, '').trim()

    // Get the task and its AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    // Only create acknowledgment if task has an AI assignee
    if (task?.assignee?.isAIAgent) {
      // Post acknowledgment comment using the new AI agent service
      const result = await createAIAgentComment(
        taskId,
        `🔄 **Change Request Received**\n\nI understand you'd like me to modify the implementation:\n\n> ${changeRequest}\n\nI'll analyze your request and update the code accordingly. Give me a few minutes to make these changes!\n\n*This is an automated response to your change request*\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post change request acknowledgment comment:')
      }
    }

    // Get workflow to find task creator
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: {
          include: { creator: true }
        }
      }
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Create orchestrator and handle change request
    const { AIOrchestrator } = await import('./ai-orchestrator')
    if (!workflow.task.creatorId) {
      throw new Error('Task creator no longer exists (deleted account)')
    }
    const orchestrator = await AIOrchestrator.createForTask(taskId, workflow.task.creatorId)
    await orchestrator.handleChangeRequest(workflowId, taskId, changeRequest)

    log.info('📝 [CommentApproval] Change request triggered successfully')

  } catch (error) {
    log.error({ err: error }, '❌ [CommentApproval] Failed to trigger change request:')

    // Post error comment using the actual AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      const result = await createAIAgentComment(
        taskId,
        `❌ **Change Request Error**\n\nI encountered an issue processing your change request:\n\n**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\nCould you please clarify what changes you'd like me to make? I'll try again with more specific instructions.\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post change request error comment:')
      }
    }
  }
}

/**
 * Trigger retry with user feedback after a failed workflow
 * This allows users to provide clarification after planning or implementation failures
 */
async function triggerRetryWithFeedback(
  workflowId: string,
  commentId: string,
  taskId: string,
  feedback: string
): Promise<void> {
  try {
    // Get the task and its AI assignee
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    // Post acknowledgment comment
    if (task?.assignee?.isAIAgent) {
      const result = await createAIAgentComment(
        taskId,
        `🔄 **Retrying with your feedback**\n\nI'll use your clarification to try again:\n\n> ${feedback.substring(0, 500)}${feedback.length > 500 ? '...' : ''}\n\nLet me re-analyze the task with this additional context.\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post retry acknowledgment comment:')
      }
    }

    // Get workflow to find task creator and previous error
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: {
          include: { creator: true }
        }
      }
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Extract the previous error from metadata for context
    const previousError = workflow.metadata && typeof workflow.metadata === 'object' && 'error' in workflow.metadata
      ? (workflow.metadata.error as string)
      : 'Unknown previous error'

    const failedStep = workflow.metadata && typeof workflow.metadata === 'object' && 'step' in workflow.metadata
      ? (workflow.metadata.step as string)
      : 'unknown'

    // Reset workflow status to allow retry
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'PENDING',
        metadata: {
          previousError,
          failedStep,
          userFeedback: feedback,
          retryTriggeredAt: new Date().toISOString(),
          retryCommentId: commentId
        }
      }
    })

    // Create orchestrator and re-run the workflow with feedback context
    const { AIOrchestrator } = await import('./ai-orchestrator')
    if (!workflow.task.creatorId) {
      throw new Error('Task creator no longer exists (deleted account)')
    }

    const orchestrator = await AIOrchestrator.createForTask(taskId, workflow.task.creatorId)

    // Call handleRetryWithFeedback which will re-run planning with additional context
    await orchestrator.handleRetryWithFeedback(workflowId, taskId, feedback, previousError)

    log.info('🔄 [CommentApproval] Retry with feedback triggered successfully')

  } catch (error) {
    log.error({ err: error }, '❌ [CommentApproval] Failed to trigger retry with feedback:')

    // Post error comment
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true }
    })

    if (task?.assignee?.isAIAgent) {
      const result = await createAIAgentComment(
        taskId,
        `❌ **Retry Failed**\n\nI couldn't retry with your feedback:\n\n**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try reassigning the task to me, or provide more details about what you'd like done.\n\n<!-- SYSTEM_GENERATED_COMMENT -->`
      )
      if (!result.success) {
        log.error(result.error, 'Failed to post retry error comment:')
      }
    }
  }
}