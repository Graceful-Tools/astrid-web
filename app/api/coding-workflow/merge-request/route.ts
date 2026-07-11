/**
 * API endpoint to handle merge requests for coding workflows
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { GitHubClient } from '@/lib/github-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.merge-request')


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

    log.info({ workflowId, commentId, taskId }, '🔀 [Merge Request] Processing merge request:')

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

    // Verify the user has permission to merge (task creator)
    if (session.user.id !== workflow.task.creatorId) {
      return NextResponse.json({ error: 'Only task creator can request merge' }, { status: 403 })
    }

    // Verify workflow is in the correct state
    if (workflow.status !== 'TESTING') {
      return NextResponse.json({
        error: `Cannot merge workflow in status: ${workflow.status}`
      }, { status: 400 })
    }

    // Verify we have PR information
    if (!workflow.pullRequestNumber || !workflow.repositoryId) {
      return NextResponse.json({
        error: 'No pull request found for this workflow'
      }, { status: 400 })
    }

    // Initialize GitHub client and merge the PR
    const githubClient = await GitHubClient.forUser(workflow.task.creatorId)

    try {
      // Merge the pull request
      await githubClient.mergePullRequest(
        workflow.repositoryId,
        workflow.pullRequestNumber,
        'squash' // merge method: 'merge' | 'squash' | 'rebase'
      )

      log.info('✅ [Merge Request] Pull request merged successfully')

    } catch (error) {
      log.error({ err: error }, '❌ [Merge Request] Failed to merge PR:')

      // Post error comment
      await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `❌ **Merge Failed**

I encountered an error while trying to merge the pull request:

\`${error instanceof Error ? error.message : 'Unknown error'}\`

Please check the GitHub repository and try again, or merge manually.`,
          type: 'MARKDOWN'
        })
      })

      return NextResponse.json({ error: 'Failed to merge pull request' }, { status: 500 })
    }

    // Update workflow status
    await prisma.codingTaskWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'COMPLETED',
        metadata: {
          ...workflow.metadata as any,
          mergedAt: new Date().toISOString(),
          mergedBy: session.user.id,
          mergeCommentId: commentId
        }
      }
    })

    // Mark task as completed
    await prisma.task.update({
      where: { id: taskId },
      data: { completed: true }
    })

    // Post completion comment
    await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🎉 **Implementation Complete!**

Your code has been successfully merged to the main branch and is now live!

**What happened:**
- ✅ Pull request #${workflow.pullRequestNumber} merged to main
- ✅ Changes are now live in production
- ✅ Task marked as completed

Thank you for using Astrid Agent! 🤖`,
        type: 'MARKDOWN'
      })
    })

    log.info('🎉 [Merge Request] Workflow completed successfully')

    return NextResponse.json({
      success: true,
      message: 'Pull request merged successfully',
      workflowId,
      status: 'COMPLETED'
    })

  } catch (error) {
    log.error({ err: error }, '❌ [Merge Request] Error processing merge request:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}