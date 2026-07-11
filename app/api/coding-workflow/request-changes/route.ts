/**
 * API endpoint to handle change requests for coding workflows
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getPreferredAIService } from '@/lib/api-key-cache'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.request-changes')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, commentId, taskId, feedback } = await request.json()

    if (!workflowId || !commentId || !taskId || !feedback) {
      return NextResponse.json(
        { error: 'Missing required fields: workflowId, commentId, taskId, feedback' },
        { status: 400 }
      )
    }

    log.info({ workflowId, commentId, taskId }, '📝 [Change Request] Processing change request:')

    // Get the workflow
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Verify the user has permission (task creator)
    if (session.user.id !== workflow.task.creatorId) {
      return NextResponse.json({ error: 'Only task creator can request changes' }, { status: 403 })
    }

    // Verify workflow is in a state where changes can be requested
    const validStates = ['AWAITING_APPROVAL', 'TESTING']
    if (!validStates.includes(workflow.status)) {
      return NextResponse.json({
        error: `Cannot request changes for workflow in status: ${workflow.status}`
      }, { status: 400 })
    }

    // Post acknowledgment comment
    await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `📝 **Change Request Received**

I've received your feedback and will work on addressing the requested changes:

> ${feedback}

**What happens next:**
1. I'll analyze your feedback and current implementation
2. Create an updated plan based on your requirements
3. Implement the requested changes
4. Update the pull request with the new code
5. Post an updated preview for your review

Working on it now... 🔧`,
        type: 'MARKDOWN'
      })
    })

    // Update workflow status
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'IMPLEMENTING',
        metadata: {
          ...workflow.metadata as any,
          changeRequested: true,
          changeRequestFeedback: feedback,
          changeRequestCommentId: commentId,
          changeRequestedAt: new Date().toISOString()
        }
      }
    })

    // Create AI orchestrator with optimal configuration based on task's list
    const orchestrator = await AIOrchestrator.createForTask(workflow.taskId, workflow.task.creatorId)

    // Start the revision process asynchronously
    orchestrator.handleChangeRequest(workflowId, taskId, feedback)
      .then(() => {
        log.info('✅ [Change Request] Revision process completed successfully')
      })
      .catch((error) => {
        log.error({ err: error }, '❌ [Change Request] Revision process failed:')

        // Post error comment
        fetch(`/api/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `❌ **Error Processing Changes**

I encountered an error while processing your change request:

\`${error instanceof Error ? error.message : 'Unknown error'}\`

Please try again or contact support if the issue persists.`,
            type: 'MARKDOWN'
          })
        })
      })

    log.info('📝 [Change Request] Change request initiated successfully')

    return NextResponse.json({
      success: true,
      message: 'Change request initiated',
      workflowId,
      status: 'IMPLEMENTING'
    })

  } catch (error) {
    log.error({ err: error }, '❌ [Change Request] Error processing change request:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}