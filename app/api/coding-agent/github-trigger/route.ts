import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getAgentService } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { FIXALL_CLAIM_AGENT_EMAIL } from '@/lib/fixall-claim'

const log = createLogger('api.coding-agent.github-trigger')

// Force dynamic rendering for webhook endpoints
export const dynamic = 'force-dynamic'

interface GitHubTriggerRequest {
  taskId: string
  githubContext: {
    repository: string
    ref: string
    sha: string
    actor: string
    workflow: string
    runId: string
    runNumber: string
  }
}

/**
 * API endpoint for GitHub Actions to trigger AI orchestration
 * Called by astrid-code-assistant.yml workflow
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'api.coding-agent.github-trigger' },
  async (request: NextRequest, auth) => {
    log.info(
      '🤖 [GitHub Trigger] Received AI orchestration request from GitHub Actions',
    )

    // Parse request
    const body: GitHubTriggerRequest = await request.json()
    const { taskId, githubContext } = body

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 },
      )
    }

    await requireTaskAccess(auth.userId, taskId)

    log.info(`📋 [GitHub Trigger] Processing task: ${taskId}`)
    log.info({ githubContext }, `🔧 [GitHub Trigger] GitHub context:`)

    // Get the task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        assignee: true,
        lists: {
          include: {
            owner: true,
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // The caller proves task access through OAuth; Astrid derives the only agent
    // this workflow may impersonate from the task's already-validated assignment.
    if (
      !task.assignee ||
      task.assignee.email.toLowerCase() !== FIXALL_CLAIM_AGENT_EMAIL ||
      !task.assignee.isAIAgent ||
      !task.assignee.isActive
    ) {
      return NextResponse.json(
        {
          error: 'Task is not assigned to the configured fixall agent',
        },
        { status: 403 },
      )
    }
    const fixallAgent = task.assignee
    log.info(
      `✅ [GitHub Trigger] Triggering as coding agent: ${fixallAgent.name}`,
    )

    log.info(`📋 [GitHub Trigger] Task verified: "${task.title}"`)
    log.info(
      `👤 [GitHub Trigger] Task creator: ${task.creator?.name || 'Deleted User'}`,
    )

    // Check if workflow already exists
    let workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId },
    })

    if (!workflow) {
      // Create new workflow with the correct AI service based on the assigned agent
      const aiService = task.assignee?.email
        ? getAgentService(task.assignee.email)
        : 'claude'

      // OpenClaw tasks use the channel plugin (SSE), not the orchestrator workflow
      if (aiService === 'openclaw') {
        log.info(
          `🔌 [GitHub Trigger] Skipping workflow creation — OpenClaw tasks use the channel plugin`,
        )
        return NextResponse.json(
          {
            success: false,
            message:
              'OpenClaw tasks are handled via the channel plugin (SSE), not the orchestrator workflow.',
            taskId,
          },
          { status: 200 },
        )
      }

      log.info(
        `🚀 [GitHub Trigger] Creating new coding workflow with aiService: ${aiService}`,
      )
      workflow = await prisma.codingTaskWorkflow.create({
        data: {
          taskId,
          status: 'PENDING',
          aiService,
          metadata: {
            githubTrigger: true,
            githubContext,
            triggeredAt: new Date().toISOString(),
          },
        },
      })
      log.info(`✅ [GitHub Trigger] Created workflow: ${workflow.id}`)
    } else {
      // Update existing workflow
      log.info(`🔄 [GitHub Trigger] Updating existing workflow: ${workflow.id}`)
      workflow = await prisma.codingTaskWorkflow.update({
        where: { id: workflow.id },
        data: {
          status: 'PENDING',
          metadata: {
            ...(workflow.metadata as any),
            githubTrigger: true,
            githubContext,
            retriggeredAt: new Date().toISOString(),
          },
        },
      })
    }

    // Initialize AI orchestrator for the task creator (who has the AI API keys)
    log.info('🤖 [GitHub Trigger] Initializing AI orchestrator...')
    if (!task.creatorId) {
      return NextResponse.json(
        {
          error: 'Task creator no longer exists (deleted account)',
        },
        { status: 404 },
      )
    }
    const orchestrator = await AIOrchestrator.createForTask(
      taskId,
      task.creatorId,
    )

    // Start the AI workflow asynchronously
    log.info('🚀 [GitHub Trigger] Starting AI orchestration workflow...')

    // Don't await this - let it run in the background
    orchestrator.executeCompleteWorkflow(workflow.id, taskId).catch((error) => {
      log.error({ err: error }, '❌ [GitHub Trigger] AI orchestration failed:')

      // Update workflow status to failed
      prisma.codingTaskWorkflow
        .update({
          where: { id: workflow.id },
          data: {
            status: 'FAILED',
            metadata: {
              ...(workflow.metadata as any),
              error: error.message,
              failedAt: new Date().toISOString(),
            },
          },
        })
        .catch((err) => log.error({ err }, 'workflow update failed'))
    })

    // Add a comment to the task indicating GitHub Actions triggered the workflow
    try {
      await prisma.comment.create({
        data: {
          content: `🚀 **GitHub Actions Triggered AI Workflow**

GitHub Actions workflow has started the AI implementation process for this task.

**Workflow Details:**
- **Repository:** ${githubContext.repository}
- **Run ID:** ${githubContext.runId}
- **Actor:** ${githubContext.actor}
- **SHA:** ${githubContext.sha.substring(0, 7)}

**Status:** AI is analyzing the task and will generate an implementation plan shortly.

**GitHub Actions URL:** https://github.com/${githubContext.repository}/actions/runs/${githubContext.runId}

The AI will post the implementation plan here for review once ready! 🤖✨`,
          type: 'MARKDOWN',
          taskId,
          authorId: fixallAgent.id,
        },
      })

      log.info('✅ [GitHub Trigger] Added status comment to task')
    } catch (commentError) {
      log.error(
        { err: commentError },
        '⚠️ [GitHub Trigger] Failed to add status comment:',
      )
    }

    // Return success response
    return NextResponse.json(
      {
        success: true,
        workflowId: workflow.id,
        status: 'AI_ORCHESTRATION_STARTED',
        message: 'AI orchestration workflow has been triggered successfully',
        githubRunUrl: `https://github.com/${githubContext.repository}/actions/runs/${githubContext.runId}`,
        taskUrl: `/tasks/${taskId}`,
      },
      { status: 200 },
    )
  },
)

/**
 * GET endpoint to check if GitHub Actions integration is available
 */
export async function GET() {
  return NextResponse.json({
    service: 'GitHub Actions AI Trigger',
    status: 'available',
    version: '1.0.0',
    endpoints: {
      trigger: 'POST /api/coding-agent/github-trigger',
      status: 'GET /api/coding-workflow/status/:taskId',
      complete: 'POST /api/coding-agent/workflow-complete',
    },
    authentication: 'Bearer MCP_TOKEN required',
    documentation:
      'https://github.com/your-org/astrid-res/blob/main/docs/ai-agents/GITHUB_CODING_AGENT_IMPLEMENTATION.md',
  })
}
