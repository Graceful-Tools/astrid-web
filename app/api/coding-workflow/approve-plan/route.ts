/**
 * API endpoint to handle plan approval for coding workflows
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getPreferredAIService } from '@/lib/api-key-cache'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.approve-plan')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, commentId, taskId } = await request.json()

    if (!workflowId || !commentId || !taskId) {
      return NextResponse.json(
        { error: 'Missing required fields: workflowId, commentId, taskId' },
        { status: 400 }
      )
    }

    log.info({ workflowId }, '✅ [Plan Approval] Processing approval for workflow:')

    // Verify the workflow exists and is in the right state
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

    if (workflow.status !== 'AWAITING_APPROVAL') {
      return NextResponse.json(
        { error: `Workflow is in ${workflow.status} state, not awaiting approval` },
        { status: 400 }
      )
    }

    // Verify the user has permission to approve (task creator or assignee)
    if (session.user.id !== workflow.task.creatorId && session.user.id !== workflow.task.assigneeId) {
      return NextResponse.json({ error: 'Not authorized to approve this workflow' }, { status: 403 })
    }

    // Create AI orchestrator instance with optimal configuration based on task's list
    if (!workflow.task.creatorId) {
      return NextResponse.json({ error: 'Task creator no longer exists (deleted account)' }, { status: 404 })
    }
    const orchestrator = await AIOrchestrator.createForTask(workflow.taskId, workflow.task.creatorId)

    // Handle the plan approval asynchronously
    orchestrator.handlePlanApproval(workflowId, commentId)
      .then(() => {
        log.info('✅ [Plan Approval] Implementation started successfully')
      })
      .catch((error) => {
        log.error({ err: error }, '❌ [Plan Approval] Implementation failed:')
      })

    // Mark workflow as plan approved
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: { planApproved: true }
    })

    return NextResponse.json({
      success: true,
      message: 'Plan approved, starting implementation',
      workflowId
    })

  } catch (error) {
    log.error({ err: error }, '❌ [Plan Approval] Error processing approval:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}