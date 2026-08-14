import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'

const log = createLogger('coding-workflow.progress.[taskId]')


export const dynamic = 'force-dynamic'

/**
 * GET /api/coding-workflow/progress/[taskId]
 * Returns real-time progress for a task's AI workflow
 *
 * Provides detailed status, phase tracking, and error information
 * for debugging and monitoring cloud AI workflows
 */
type RouteContext = { params: Promise<{ taskId: string }> }

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'coding-workflow.progress' },
  async (_req, auth, { params }) => {
  const { taskId } = await params

  if (!taskId) {
    return NextResponse.json({
      error: 'Task ID is required'
    }, { status: 400 })
  }

  // This endpoint returns the task's title and description, previews of the AI
  // agent's comments, and the repository id, branch, PR number and deployment
  // URL it is working in. It previously required no auth at all, so a task id
  // was enough to read all of it. (Task e0613ae5.)
  //
  // Deliberately OUTSIDE the try/catch below: that block turns anything thrown
  // into a 500, which would swallow the ForbiddenError and answer an
  // unauthorised caller with "Internal server error" instead of 403.
  await requireTaskAccess(auth.userId, taskId)

  try {

    // Get the workflow for this task
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
      include: {
        task: {
          select: {
            title: true,
            description: true,
            createdAt: true
          }
        }
      }
    })

    if (!workflow) {
      return NextResponse.json({
        error: 'No workflow found for this task',
        taskId
      }, { status: 404 })
    }

    // Extract metadata
    const metadata = workflow.metadata as any || {}

    // Get recent comments from AI agent for progress updates
    const recentComments = await prisma.comment.findMany({
      where: {
        taskId,
        author: {
          isAIAgent: true
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10,
      select: {
        content: true,
        createdAt: true,
        type: true
      }
    })

    // Calculate progress based on status
    const completedSteps = getCompletedSteps(workflow.status)
    const totalSteps = 5
    const percentComplete = Math.round((completedSteps / totalSteps) * 100)

    // Estimate time remaining
    const startedAt = metadata.startedAt ? new Date(metadata.startedAt) : workflow.createdAt
    const elapsed = Date.now() - startedAt.getTime()
    const estimatedTotal = getEstimatedDuration(workflow.status, elapsed)
    const estimatedRemaining = Math.max(0, estimatedTotal - elapsed)

    return NextResponse.json({
      taskId,
      workflowId: workflow.id,
      status: workflow.status,
      traceId: metadata.traceId || 'no-trace-id',

      // Task details
      task: {
        title: workflow.task.title,
        description: workflow.task.description?.substring(0, 200),
        createdAt: workflow.task.createdAt
      },

      // Progress details
      progress: {
        phase: workflow.status,
        message: getPhaseMessage(workflow.status, metadata),
        completedSteps,
        totalSteps,
        percentComplete
      },

      // Timing information
      timing: {
        startedAt: startedAt.toISOString(),
        lastUpdate: metadata.lastUpdate || workflow.updatedAt.toISOString(),
        elapsedMs: elapsed,
        estimatedRemainingMs: estimatedRemaining,
        estimatedTotalMs: estimatedTotal
      },

      // Recent activity (last 10 comments)
      recentActivity: recentComments.map(c => ({
        timestamp: c.createdAt,
        message: extractFirstLine(c.content),
        preview: c.content.substring(0, 200)
      })),

      // GitHub/Vercel deployment details if available
      deployment: {
        branch: workflow.workingBranch,
        prNumber: workflow.pullRequestNumber,
        repositoryId: workflow.repositoryId,
        deploymentUrl: workflow.deploymentUrl,
        prUrl: workflow.pullRequestNumber ?
          `https://github.com/${workflow.repositoryId}/pull/${workflow.pullRequestNumber}` :
          null
      },

      // Error details if failed
      error: workflow.status === 'FAILED' ? {
        message: metadata.error || 'Workflow failed',
        phase: metadata.failedPhase || metadata.step,
        details: metadata.errorDetails,
        timestamp: metadata.failedAt || metadata.timestamp
      } : null,

      // Metadata for debugging
      _debug: {
        workflowCreatedAt: workflow.createdAt,
        workflowUpdatedAt: workflow.updatedAt,
        aiService: workflow.aiService,
        hasMetadata: !!metadata && Object.keys(metadata).length > 0
      }
    })

  } catch (error) {
    log.error({ err: error }, 'Error fetching workflow progress:')
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
})

/**
 * Calculate completed steps based on workflow status
 */
function getCompletedSteps(status: string): number {
  const steps: Record<string, number> = {
    'PENDING': 0,
    'PLANNING': 1,
    'AWAITING_APPROVAL': 2,
    'IMPLEMENTING': 3,
    'TESTING': 4,
    'READY_TO_MERGE': 4,
    'COMPLETED': 5,
    'FAILED': 0,
    'CANCELLED': 0
  }
  return steps[status] || 0
}

/**
 * Get user-friendly message for current phase
 */
function getPhaseMessage(status: string, metadata: any): string {
  const messages: Record<string, string> = {
    'PENDING': 'Workflow queued, starting soon...',
    'PLANNING': 'Analyzing codebase and creating implementation plan...',
    'AWAITING_APPROVAL': 'Implementation plan ready for review',
    'IMPLEMENTING': 'Generating code changes...',
    'TESTING': 'Creating pull request and deploying preview...',
    'READY_TO_MERGE': 'Pull request ready for review!',
    'COMPLETED': 'Workflow completed successfully!',
    'FAILED': `Workflow failed: ${metadata.error || 'Unknown error'}`,
    'CANCELLED': 'Workflow was cancelled'
  }
  return metadata.currentMessage || messages[status] || `Status: ${status}`
}

/**
 * Estimate total duration based on current phase
 */
function getEstimatedDuration(status: string, elapsed: number): number {
  const estimates: Record<string, number> = {
    'PENDING': 2 * 60 * 1000,      // 2 minutes
    'PLANNING': 10 * 60 * 1000,     // 10 minutes total
    'IMPLEMENTING': 20 * 60 * 1000, // 20 minutes total
    'TESTING': 25 * 60 * 1000,      // 25 minutes total
    'COMPLETED': elapsed,
    'FAILED': elapsed
  }

  // Return estimate or actual elapsed time if longer
  return Math.max(elapsed, estimates[status] || 15 * 60 * 1000)
}

/**
 * Extract first line of content (usually the title/status)
 */
function extractFirstLine(content: string): string {
  const firstLine = content.split('\n')[0]
  // Remove markdown formatting
  return firstLine.replace(/[*#_`]/g, '').trim().substring(0, 100)
}
