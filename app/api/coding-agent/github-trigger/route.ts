import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { isCodingAgent } from '@/lib/ai-agent-utils'
import { getAgentService } from '@/lib/ai/agent-config'
// GitHub trigger uses MCP authentication, not sessions

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
export async function POST(request: NextRequest) {
  try {
    console.log('🤖 [GitHub Trigger] Received AI orchestration request from GitHub Actions')

    // Parse request
    const body: GitHubTriggerRequest = await request.json()
    const { taskId, githubContext } = body

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 })
    }

    console.log(`📋 [GitHub Trigger] Processing task: ${taskId}`)
    console.log(`🔧 [GitHub Trigger] GitHub context:`, githubContext)

    // Validate MCP token authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'MCP token required' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Find the MCP token and associated user
    const mcpToken = await prisma.mCPToken.findFirst({
      where: {
        token,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        user: true
      }
    })

    if (!mcpToken) {
      return NextResponse.json({ error: 'Invalid or expired MCP token' }, { status: 401 })
    }

    // Verify this is the coding agent user
    if (!isCodingAgent(mcpToken.user)) {
      return NextResponse.json({ error: 'Only coding agents can trigger this endpoint' }, { status: 403 })
    }

    console.log(`✅ [GitHub Trigger] Authenticated as coding agent: ${mcpToken.user.name}`)

    // Get the task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        assignee: true,
        lists: {
          include: {
            owner: true
          }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Verify the task is assigned to the coding agent
    if (!task.assignee || task.assignee.id !== mcpToken.user.id) {
      return NextResponse.json({
        error: 'Task is not assigned to the coding agent'
      }, { status: 403 })
    }

    console.log(`📋 [GitHub Trigger] Task verified: "${task.title}"`)
    console.log(`👤 [GitHub Trigger] Task creator: ${task.creator?.name || 'Deleted User'}`)

    // Check if workflow already exists
    let workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId }
    })

    if (!workflow) {
      // Create new workflow with the correct AI service based on the assigned agent
      const aiService = task.assignee?.email ? getAgentService(task.assignee.email) : 'claude'

      // OpenClaw tasks use the channel plugin (SSE), not the orchestrator workflow
      if (aiService === 'openclaw') {
        console.log(`🔌 [GitHub Trigger] Skipping workflow creation — OpenClaw tasks use the channel plugin`)
        return NextResponse.json({
          success: false,
          message: 'OpenClaw tasks are handled via the channel plugin (SSE), not the orchestrator workflow.',
          taskId
        }, { status: 200 })
      }

      console.log(`🚀 [GitHub Trigger] Creating new coding workflow with aiService: ${aiService}`)
      workflow = await prisma.codingTaskWorkflow.create({
        data: {
          taskId,
          status: 'PENDING',
          aiService,
          metadata: {
            githubTrigger: true,
            githubContext,
            triggeredAt: new Date().toISOString()
          }
        }
      })
      console.log(`✅ [GitHub Trigger] Created workflow: ${workflow.id}`)
    } else {
      // Update existing workflow
      console.log(`🔄 [GitHub Trigger] Updating existing workflow: ${workflow.id}`)
      workflow = await prisma.codingTaskWorkflow.update({
        where: { id: workflow.id },
        data: {
          status: 'PENDING',
          metadata: {
            ...workflow.metadata as any,
            githubTrigger: true,
            githubContext,
            retriggeredAt: new Date().toISOString()
          }
        }
      })
    }

    // Initialize AI orchestrator for the task creator (who has the AI API keys)
    console.log('🤖 [GitHub Trigger] Initializing AI orchestrator...')
    if (!task.creatorId) {
      return NextResponse.json({
        error: 'Task creator no longer exists (deleted account)'
      }, { status: 404 })
    }
    const orchestrator = await AIOrchestrator.createForTask(taskId, task.creatorId)

    // Start the AI workflow asynchronously
    console.log('🚀 [GitHub Trigger] Starting AI orchestration workflow...')

    // Don't await this - let it run in the background
    orchestrator.executeCompleteWorkflow(workflow.id, taskId).catch((error) => {
      console.error('❌ [GitHub Trigger] AI orchestration failed:', error)

      // Update workflow status to failed
      prisma.codingTaskWorkflow.update({
        where: { id: workflow.id },
        data: {
          status: 'FAILED',
          metadata: {
            ...workflow.metadata as any,
            error: error.message,
            failedAt: new Date().toISOString()
          }
        }
      }).catch(console.error)
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
          authorId: mcpToken.user.id
        }
      })

      console.log('✅ [GitHub Trigger] Added status comment to task')
    } catch (commentError) {
      console.error('⚠️ [GitHub Trigger] Failed to add status comment:', commentError)
    }

    // Return success response
    return NextResponse.json({
      success: true,
      workflowId: workflow.id,
      status: 'AI_ORCHESTRATION_STARTED',
      message: 'AI orchestration workflow has been triggered successfully',
      githubRunUrl: `https://github.com/${githubContext.repository}/actions/runs/${githubContext.runId}`,
      taskUrl: `/tasks/${taskId}`
    }, { status: 200 })

  } catch (error) {
    console.error('❌ [GitHub Trigger] Error:', error)

    return NextResponse.json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
    }, { status: 500 })
  }
}

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
      complete: 'POST /api/coding-agent/workflow-complete'
    },
    authentication: 'Bearer MCP_TOKEN required',
    documentation: 'https://github.com/your-org/astrid-res/blob/main/docs/ai-agents/GITHUB_CODING_AGENT_IMPLEMENTATION.md'
  })
}