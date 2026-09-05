/**
 * Phase 3: GitHub Webhook Handler
 * Handles GitHub App webhook events
 */

import { NextRequest, NextResponse } from 'next/server'
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks'
import { prisma } from '@/lib/prisma'
import { reconcileTaskLifecycleAfterMutation } from '@/lib/agent-lifecycle-mutations'
import crypto from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('api.github.webhooks')


// Initialize webhooks only if secret is available
const webhooks = process.env.GITHUB_WEBHOOK_SECRET ? new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET
}) : null

/**
 * Verify webhook signature
 */
function verifySignature(body: string, signature: string): boolean {
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('hex')

  const actualSignature = signature.replace('sha256=', '')

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(actualSignature, 'hex')
  )
}

/**
 * Send SSE notification
 */
async function sendSSENotification(userId: string, event: any) {
  try {
    // Use your existing SSE system
    const { sendEventToUser } = await import('@/lib/sse-utils')
    await sendEventToUser(userId, event)
  } catch (error) {
    log.error({ err: error }, 'Failed to send SSE notification:')
  }
}

/**
 * Handle GitHub App installation events
 */
webhooks?.on('installation', async ({ payload }) => {
  log.info({ action: payload.action }, '🔧 GitHub App installation event:')

  if (payload.action === 'created') {
    const account = payload.installation.account
    log.info({
      installationId: payload.installation.id,
      account: account && 'login' in account ? account.login : 'unknown',
      repositories: payload.repositories?.length || 0
    }, '📦 New installation:')

    // Store installation info (we'll need to associate with user later)
    // For now, just log it
    log.info('ℹ️ Installation will be associated when user connects their GitHub')
  }

  if (payload.action === 'deleted') {
    log.info(payload.installation.id, '🗑️ Installation removed:')

    // Clean up any GitHub integrations using this installation
    await prisma.gitHubIntegration.deleteMany({
      where: { installationId: payload.installation.id }
    })
  }
})

/**
 * Handle repository access changes
 */
webhooks?.on('installation_repositories', async ({ payload }) => {
  log.info({ action: payload.action }, '📚 Repository access changed:')

  // Update repository lists for affected integrations
  const integrations = await prisma.gitHubIntegration.findMany({
    where: { installationId: payload.installation.id }
  })

  for (const integration of integrations) {
    if (payload.action === 'added') {
      const currentRepos = Array.isArray(integration.repositories)
        ? integration.repositories as any[]
        : []

      const newRepos = payload.repositories_added?.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: ('default_branch' in repo ? repo.default_branch : null) || 'main'
      })) || []

      await prisma.gitHubIntegration.update({
        where: { id: integration.id },
        data: {
          repositories: [...currentRepos, ...newRepos]
        }
      })

      log.info(`✅ Added ${newRepos.length} repositories to integration ${integration.id}`)
    }

    if (payload.action === 'removed') {
      const currentRepos = Array.isArray(integration.repositories)
        ? integration.repositories as any[]
        : []

      const removedRepoIds = payload.repositories_removed?.map(repo => repo.id) || []
      const updatedRepos = currentRepos.filter(repo => !removedRepoIds.includes(repo.id))

      await prisma.gitHubIntegration.update({
        where: { id: integration.id },
        data: {
          repositories: updatedRepos
        }
      })

      log.info(`🗑️ Removed ${removedRepoIds.length} repositories from integration ${integration.id}`)
    }
  }
})

/**
 * Handle pull request events
 */
webhooks?.on('pull_request', async ({ payload }) => {
  log.info({ action: payload.action, prNumber: payload.pull_request.number }, '🔀 Pull request event')

  if (payload.action === 'opened' || payload.action === 'synchronize') {
    // Find any coding workflows that might be associated with this PR
    const workflows = await prisma.codingTaskWorkflow.findMany({
      where: {
        pullRequestNumber: payload.pull_request.number,
        repositoryId: payload.repository.full_name
      },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    for (const workflow of workflows) {
      if (payload.action === 'opened') {
        // PR was created - update workflow status
        await prisma.codingTaskWorkflow.update({
          where: { id: workflow.id },
          data: {
            status: 'TESTING',
            metadata: {
              ...workflow.metadata as any,
              prCreated: true,
              prUrl: payload.pull_request.html_url,
              prNumber: payload.pull_request.number
            }
          }
        })

        // Notify the task creator
        if (workflow.task.creatorId) {
          await sendSSENotification(workflow.task.creatorId, {
            type: 'coding_pr_created',
          data: {
            taskId: workflow.taskId,
            workflowId: workflow.id,
            prNumber: payload.pull_request.number,
            prUrl: payload.pull_request.html_url
          }
          })
        }

        log.info(`📋 Updated workflow ${workflow.id} for PR #${payload.pull_request.number}`)
      }
    }
  }

  if (payload.action === 'closed' && payload.pull_request.merged) {
    // PR was merged - mark workflows as completed
    const workflows = await prisma.codingTaskWorkflow.findMany({
      where: {
        pullRequestNumber: payload.pull_request.number,
        repositoryId: payload.repository.full_name
      },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    for (const workflow of workflows) {
      await prisma.codingTaskWorkflow.update({
        where: { id: workflow.id },
        data: {
          status: 'COMPLETED',
          metadata: {
            ...workflow.metadata as any,
            prMerged: true,
            mergedAt: new Date().toISOString(),
            mergeCommitSha: payload.pull_request.merge_commit_sha
          }
        }
      })

      // Mark the task as completed
      await prisma.task.update({
        where: { id: workflow.taskId },
        data: { completed: true }
      })
      await reconcileTaskLifecycleAfterMutation(workflow.taskId, { completed: true })

      // Notify the task creator
      if (workflow.task.creatorId) {
        await sendSSENotification(workflow.task.creatorId, {
          type: 'coding_task_completed',
          data: {
            taskId: workflow.taskId,
            workflowId: workflow.id,
            prNumber: payload.pull_request.number
          }
        })
      }

      log.info(`✅ Completed workflow ${workflow.id} - PR #${payload.pull_request.number} merged`)
    }
  }
})

/**
 * Handle issue comment events (for plan approval)
 */
webhooks?.on('issue_comment', async ({ payload }) => {
  if (payload.action !== 'created') return

  log.info(payload.issue.number, '💬 New comment on issue/PR:')

  const comment = payload.comment.body?.toLowerCase() || ''

  // Check for approval keywords
  const isApproval = comment.includes('approve') || comment.includes('lgtm') || comment.includes('looks good')
  const isMergeRequest = comment.includes('merge') || comment.includes('ship it')

  if (isApproval || isMergeRequest) {
    // Look for workflows associated with this issue/PR
    let workflows: any[] = []

    if (payload.issue.pull_request) {
      // This is a PR comment
      workflows = await prisma.codingTaskWorkflow.findMany({
        where: {
          pullRequestNumber: payload.issue.number,
          repositoryId: payload.repository.full_name
        },
        include: {
          task: {
            include: {
              creator: true
            }
          }
        }
      })
    } else {
      // This might be a task comment - check if commenter is the task creator
      // and look for workflows in planning stage
      workflows = await prisma.codingTaskWorkflow.findMany({
        where: {
          status: 'AWAITING_APPROVAL',
          task: {
            comments: {
              some: {
                id: payload.comment.id.toString()
              }
            }
          }
        },
        include: {
          task: {
            include: {
              creator: true,
              comments: true
            }
          }
        }
      })
    }

    for (const workflow of workflows) {
      if (isApproval && workflow.status === 'AWAITING_APPROVAL') {
        // Send approval notification
        if (workflow.task.creatorId) {
          await sendSSENotification(workflow.task.creatorId, {
            type: 'coding_plan_approved',
            data: {
              taskId: workflow.taskId,
              workflowId: workflow.id,
              commentId: payload.comment.id,
              approver: payload.comment.user?.login
            }
          })
        }

        log.info(`✅ Plan approved for workflow ${workflow.id}`)
      }

      if (isMergeRequest && workflow.status === 'TESTING') {
        // Send merge request notification
        if (workflow.task.creatorId) {
          await sendSSENotification(workflow.task.creatorId, {
            type: 'coding_merge_requested',
            data: {
              taskId: workflow.taskId,
              workflowId: workflow.id,
              commentId: payload.comment.id,
              requester: payload.comment.user?.login
            }
          })
        }

        log.info(`🔀 Merge requested for workflow ${workflow.id}`)
      }
    }
  }
})

/**
 * Handle push events (for deployment monitoring)
 */
webhooks?.on('push', async ({ payload }) => {
  if (payload.ref === `refs/heads/${payload.repository.default_branch}`) {
    log.info({ repository: payload.repository.full_name }, '🚀 Push to main branch')

    // Find any recently completed workflows for this repository
    const recentWorkflows = await prisma.codingTaskWorkflow.findMany({
      where: {
        repositoryId: payload.repository.full_name,
        status: 'COMPLETED',
        updatedAt: {
          gte: new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
        }
      },
      include: {
        task: {
          include: {
            creator: true
          }
        }
      }
    })

    for (const workflow of recentWorkflows) {
      // Notify about main branch deployment
      if (workflow.task.creatorId) {
        await sendSSENotification(workflow.task.creatorId, {
          type: 'coding_deployment_updated',
          data: {
            taskId: workflow.taskId,
            workflowId: workflow.id,
            repository: payload.repository.full_name,
            commit: payload.head_commit?.id,
            message: payload.head_commit?.message
          }
        })
      }
    }
  }
})

/**
 * Error handler
 */
webhooks?.onError((error) => {
  log.error({ err: error }, '❌ GitHub webhook error:')
})

/**
 * POST handler for GitHub webhooks
 */
export async function POST(request: NextRequest) {
  try {
    // Check if webhooks are configured
    if (!webhooks || !process.env.GITHUB_WEBHOOK_SECRET) {
      log.info('⚠️ GitHub webhook received but GITHUB_WEBHOOK_SECRET not configured')
      return NextResponse.json({
        error: 'GitHub webhooks not configured'
      }, { status: 503 })
    }

    const body = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    if (!signature) {
      log.error('❌ No signature provided')
      return NextResponse.json({ error: 'No signature provided' }, { status: 401 })
    }

    // Verify webhook signature
    if (!verifySignature(body, signature)) {
      log.error('❌ Invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = request.headers.get('x-github-event')
    if (!event) {
      log.error('❌ No event type provided')
      return NextResponse.json({ error: 'No event type provided' }, { status: 400 })
    }

    log.info(`📡 Received GitHub webhook: ${event}`)

    // Parse the payload
    const payload = JSON.parse(body)

    // Emit the webhook event
    await webhooks.receive({
      id: request.headers.get('x-github-delivery') || 'unknown',
      name: event as any,
      payload
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    log.error({ err: error }, '❌ Error processing webhook:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET handler for webhook health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    webhook: 'github-coding-agent',
    timestamp: new Date().toISOString()
  })
}