/**
 * API endpoint to get coding workflow status for a task
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'
import { hasExplicitListRole } from "@/lib/list-permissions"

const log = createLogger('coding-workflow.status.[taskId]')


export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ taskId: string }>
) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await context.params

    // Get the workflow for this task
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
      include: {
        task: {
          include: {
            creator: true,
            assignee: true,
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
        }
      }
    })

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to view this workflow
    const userHasAccess =
      workflow.task.creatorId === session.user.id ||
      workflow.task.assigneeId === session.user.id ||
      workflow.task.lists.some(list => hasExplicitListRole({ id: session.user.id }, list as never))

    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Calculate progress percentage based on status
    const statusProgress: Record<string, number> = {
      'PENDING': 0,
      'PLANNING': 20,
      'AWAITING_APPROVAL': 40,
      'IMPLEMENTING': 60,
      'TESTING': 80,
      'READY_TO_MERGE': 90,
      'COMPLETED': 100,
      'FAILED': 0,
      'CANCELLED': 0
    }

    const progress = statusProgress[workflow.status] || 0

    return NextResponse.json({
      workflow: {
        id: workflow.id,
        taskId: workflow.taskId,
        status: workflow.status,
        aiService: workflow.aiService,
        repositoryId: workflow.repositoryId,
        baseBranch: workflow.baseBranch,
        workingBranch: workflow.workingBranch,
        pullRequestNumber: workflow.pullRequestNumber,
        planApproved: workflow.planApproved,
        deploymentUrl: workflow.deploymentUrl,
        previewUrl: workflow.previewUrl,
        metadata: workflow.metadata,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt
      },
      progress,
      statusText: workflow.status.toLowerCase().replace('_', ' '),
      canApprove: workflow.status === 'AWAITING_APPROVAL',
      canMerge: workflow.status === 'READY_TO_MERGE',
      isCompleted: workflow.status === 'COMPLETED',
      hasFailed: workflow.status === 'FAILED'
    })

  } catch (error) {
    log.error({ err: error }, 'Error getting workflow status:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
