/**
 * Shared post-comment side effects.
 *
 * Both the legacy `/api/tasks/[id]/comments` route and the versioned
 * `/api/v1/tasks/[id]/comments` route need to fire the same side effects after
 * a comment is created: push notifications, AI-agent triggering on @-mentions,
 * workflow command detection (approve/ship-it/changes), AI-agent workflow
 * resume, and stats invalidation. Keeping them in one place prevents the
 * surfaces from drifting (e.g. iOS comments not waking up the assigned agent
 * because v1 lacked the trigger logic).
 *
 * All side effects are best-effort: failures are logged and swallowed so they
 * never fail the request that already created the comment.
 */
import { BRAND } from '@/lib/brand/config'
import { prisma } from '@/lib/prisma'
import { invalidateUserStats } from '@/lib/user-stats'
import { getAgentService } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'
import { fanOutComment } from '@/lib/notifications'
import { persistNotifications } from '@/lib/notification-store'

const log = createLogger('comments.post-comment-side-effects')


interface CommenterInfo {
  id: string
  name: string | null | undefined
  email: string | null | undefined
  isAIAgent: boolean
}

interface TaskInfo {
  id: string
  title: string
  creatorId: string | null
  assigneeId: string | null
  assignee: {
    id?: string
    email: string | null
    name?: string | null
    isAIAgent: boolean
    aiAgentType?: string | null
  } | null
  lists: Array<{
    id: string
    githubRepositoryId?: string | null
    aiAgentConfiguredBy?: string | null
  }>
}

interface CommentInfo {
  id: string
  content: string
}

export interface PostCommentSideEffectsOptions {
  comment: CommentInfo
  task: TaskInfo
  commenter: CommenterInfo
}

const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g
const SYSTEM_GENERATED_MARKER = '<!-- SYSTEM_GENERATED_COMMENT -->'

function extractMentionedUserIds(content: string): Set<string> {
  const ids = new Set<string>()
  let match: RegExpExecArray | null
  const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags)
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[2])
  }
  return ids
}

/**
 * Fire all post-comment side effects. Safe to await — never throws.
 */
export async function dispatchPostCommentSideEffects(
  opts: PostCommentSideEffectsOptions
): Promise<void> {
  const { comment, task, commenter } = opts
  const isSystemGenerated = comment.content.includes(SYSTEM_GENERATED_MARKER)

  await Promise.allSettled([
    invalidateStatsForOthersTask(task, commenter.id),
    notifyMentionsAndTriggerAgents(comment, task, commenter),
    detectWorkflowAction(comment, task.id, commenter),
    notifyAssigneeAgent(comment, task, commenter, isSystemGenerated),
  ])
}

async function invalidateStatsForOthersTask(
  task: TaskInfo,
  commenterId: string
): Promise<void> {
  if (task.creatorId === commenterId || !task.creatorId) return
  try {
    await invalidateUserStats(commenterId)
  } catch (err) {
    log.error({ err: err }, '[comments] Failed to invalidate user stats:')
  }
}

async function notifyMentionsAndTriggerAgents(
  comment: CommentInfo,
  task: TaskInfo,
  commenter: CommenterInfo
): Promise<void> {
  const mentionedUserIds = extractMentionedUserIds(comment.content || '')

  await persistInAppCommentNotifications(comment, task, commenter, mentionedUserIds)

  let pushService: import('@/lib/push-notification-service').PushNotificationService | null = null
  const commenterName = commenter.name || commenter.email || 'Someone'

  for (const mentionedUserId of mentionedUserIds) {
    if (mentionedUserId === commenter.id) continue

    try {
      const mentionedUser = await prisma.user.findUnique({
        where: { id: mentionedUserId },
        select: { id: true, isAIAgent: true, email: true },
      })
      if (!mentionedUser) continue

      if (mentionedUser.isAIAgent) {
        const { ASTRID_EMAIL } = await import('@/lib/astrid-agent')
        if (mentionedUser.email === ASTRID_EMAIL) {
          const { processAstridComment } = await import('@/lib/astrid-agent-runtime')
          const listId = task.lists?.[0]?.id || null
          processAstridComment({
            commentContent: comment.content,
            userId: commenter.id,
            userName: commenterName,
            taskId: task.id,
            taskTitle: task.title,
            listId,
          }).catch(err =>
            log.error({ err: err }, `[comments] ${BRAND.appName} @mention processing error:`)
          )
        }
      } else {
        if (!pushService) {
          const { PushNotificationService } = await import('@/lib/push-notification-service')
          pushService = new PushNotificationService()
        }
        await pushService.sendCommentNotification(mentionedUserId, {
          taskId: task.id,
          commentId: comment.id,
          taskTitle: task.title,
          commenterName,
          content: comment.content,
          type: 'mention',
        })
      }
    } catch (err) {
      log.error({ err: err }, `[comments] mention handling failed for user ${mentionedUserId}:`)
    }
  }

  async function persistInAppCommentNotifications(
    comment: CommentInfo,
    task: TaskInfo,
    commenter: CommenterInfo,
    mentionedUserIds: Set<string>
  ): Promise<void> {
    try {
      await persistNotifications({
        targets: fanOutComment({
          actorId: commenter.id,
          audience: {
            assigneeId: task.assigneeId,
            creatorId: task.creatorId,
            mentionedUserIds: Array.from(mentionedUserIds),
          },
        }),
        context: {
          taskId: task.id,
          commentId: comment.id,
          actorId: commenter.id,
        },
      })
    } catch (err) {
      log.error({ err: err }, '[comments] failed to persist in-app notifications:')
    }
  }

  // Push to assignee if not already mentioned and not the commenter
  if (
    task.assigneeId &&
    task.assigneeId !== commenter.id &&
    !mentionedUserIds.has(task.assigneeId) &&
    !task.assignee?.isAIAgent
  ) {
    try {
      if (!pushService) {
        const { PushNotificationService } = await import('@/lib/push-notification-service')
        pushService = new PushNotificationService()
      }
      await pushService.sendCommentNotification(task.assigneeId, {
        taskId: task.id,
        commentId: comment.id,
        taskTitle: task.title,
        commenterName,
        content: comment.content,
        type: 'assignment',
      })
    } catch (err) {
      log.error({ err: err }, '[comments] assignee push notification failed:')
    }
  }
}

async function detectWorkflowAction(
  comment: CommentInfo,
  taskId: string,
  commenter: CommenterInfo
): Promise<void> {
  // Skip workflow command processing for AI-agent comments to prevent loops.
  if (commenter.isAIAgent) return
  if (!comment.content?.trim()) return

  try {
    const { processCommentForWorkflowAction } = await import('@/lib/comment-approval-detector')
    await processCommentForWorkflowAction(taskId, comment.id, comment.content, commenter.id)
  } catch (err) {
    log.error({ err: err }, '[comments] workflow action detection failed:')
  }
}

async function notifyAssigneeAgent(
  comment: CommentInfo,
  task: TaskInfo,
  commenter: CommenterInfo,
  isSystemGenerated: boolean
): Promise<void> {
  // Wake up the AI agent assigned to this task. Skip when:
  //  - no assignee, or assignee is not an AI agent
  //  - the commenter IS an AI agent (prevent self-loop)
  //  - the comment is system-generated (prevent automation loops)
  if (!task.assigneeId || !task.assignee?.isAIAgent) return
  if (commenter.isAIAgent) return
  if (isSystemGenerated) return

  try {
    const isCodingAgent =
      task.assignee.aiAgentType === 'coding_agent' ||
      task.assignee.email?.includes('claude@') ||
      task.assignee.name?.includes('Claude')

    if (isCodingAgent) {
      await resumeCodingAgentWorkflow(comment, task, commenter)
    } else {
      const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
      await aiAgentWebhookService.notifyCommentOnAssignedTask(
        task.id,
        comment.id,
        comment.content,
        commenter.name || commenter.email || 'Someone'
      )
    }
  } catch (err) {
    log.error({ err: err }, '[comments] notifying assignee agent failed:')
  }
}

async function resumeCodingAgentWorkflow(
  comment: CommentInfo,
  task: TaskInfo,
  commenter: CommenterInfo
): Promise<void> {
  const listWithRepo = task.lists?.find(l => l.githubRepositoryId)
  if (!listWithRepo?.githubRepositoryId) return

  const { AIOrchestrator } = await import('@/lib/ai-orchestrator')
  const configuredByUserId =
    listWithRepo.aiAgentConfiguredBy || task.creatorId || commenter.id

  let workflow = await prisma.codingTaskWorkflow.findUnique({
    where: { taskId: task.id },
  })

  // If a workflow already produced a PR or progressed past planning, let
  // processCommentForWorkflowAction handle change requests instead of restarting.
  const workflowAlreadyProcessed =
    workflow &&
    (workflow.pullRequestNumber !== null ||
      workflow.status === 'TESTING' ||
      workflow.status === 'COMPLETED' ||
      workflow.status === 'READY_TO_MERGE')

  if (workflowAlreadyProcessed) return

  if (!workflow) {
    const aiService = task.assignee?.email ? getAgentService(task.assignee.email) : 'claude'

    // OpenClaw tasks use the channel plugin (SSE), not orchestrator workflow.
    if (aiService === 'openclaw') return

    workflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId: task.id,
        status: 'PENDING',
        aiService,
        repositoryId: listWithRepo.githubRepositoryId,
        metadata: {
          triggeredBy: 'user_comment',
          userComment: comment.content,
          timestamp: new Date().toISOString(),
        },
      },
    })
  }

  const orchestrator = await AIOrchestrator.createForTask(task.id, configuredByUserId)
  const workflowId = workflow.id
  orchestrator
    .executeCompleteWorkflow(workflowId, task.id)
    .catch(async err => {
      log.error({ err: err }, '[comments] AIOrchestrator workflow failed:')
      try {
        await prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'FAILED',
            metadata: {
              error: err instanceof Error ? err.message : String(err),
              failedAt: new Date().toISOString(),
            },
          },
        })
      } catch (e) {
        log.error({ err: e }, '[comments] Failed to update workflow status to FAILED:')
      }
    })
}
