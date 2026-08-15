/**
 * Start the tools-based AI coding workflow for a task.
 *
 * Extracted from app/api/coding-workflow/start-tools-workflow so that SERVER
 * CALLERS CAN CALL IT DIRECTLY instead of fetching this app's own HTTP API.
 * (Task 46acd19c; Jon: "do your recommendation", which was exactly this.)
 *
 * WHY THAT MATTERED. lib/webhooks/comment-notifier.ts triggered this by
 * fetching `${baseUrl}/api/coding-workflow/start-tools-workflow` with no cookie
 * and no token. The handler resolves the caller with getUnifiedSession(), which
 * with no request argument reads cookies from the ambient request — of which
 * there are none server-to-server. So it answered 401, the notifier logged
 * "✅ Tools workflow triggered" BEFORE inspecting the response, and the failure
 * was invisible. A workflow that should have started did not, and the logs said
 * it had.
 *
 * A same-process trigger has no reason to go through the network. Calling the
 * function removes the authentication question rather than answering it: there
 * is no request, so there is no session to fake, no internal secret to leak,
 * and no second way into the route. The route keeps its own authorization for
 * the one caller that IS a request.
 *
 * AUTHORIZATION IS THE CALLER'S JOB, deliberately. This function does not check
 * who is asking, because its two callers know different things: the route
 * checks that the HTTP caller may act on the task (services/task.service), and
 * the notifier already knows it is reacting to a comment on a task whose
 * assignee is an internal coding agent. Putting a check in here would mean
 * inventing an identity for the notifier that does not exist.
 */

import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getAgentConfig } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.start-tools')

export type StartToolsWorkflowResult =
  | { ok: true; workflowId: string; taskId: string }
  | { ok: false; status: 400 | 404; error: string }

export async function startToolsWorkflow(args: {
  taskId: string
  repository: string
  userComment?: string
}): Promise<StartToolsWorkflowResult> {
  const { taskId, repository, userComment } = args

  if (!taskId || !repository) {
    return { ok: false, status: 400, error: 'Missing required fields: taskId, repository' }
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: true,
      aiAgent: true,
      lists: { select: { aiAgentConfiguredBy: true, githubRepositoryId: true } },
    },
  })

  if (!task) {
    return { ok: false, status: 404, error: 'Task not found' }
  }

  // The API keys belong to whoever configured the agent on the list, not to
  // whoever triggered the run — which is why this function needs no caller.
  const listWithRepo = task.lists?.find(l => l.githubRepositoryId)
  const configuredByUserId =
    listWithRepo?.aiAgentConfiguredBy || task.lists[0]?.aiAgentConfiguredBy

  if (!configuredByUserId) {
    return { ok: false, status: 400, error: 'No user has configured an AI agent for this list' }
  }

  const aiAgentId = task.aiAgent?.id || (task.assignee?.isAIAgent ? task.assignee.id : null)
  if (!aiAgentId) {
    return { ok: false, status: 400, error: 'Task is not assigned to an AI agent' }
  }

  // This workflow supports claude/openai only; anything else keeps the default.
  let aiService: 'claude' | 'openai' = 'claude'
  if (task.assignee?.isAIAgent && task.assignee.email) {
    const service = getAgentConfig(task.assignee.email)?.service
    if (service === 'claude' || service === 'openai') {
      aiService = service
    }
  }

  const orchestrator = await AIOrchestrator.createForTaskWithService(
    taskId,
    configuredByUserId,
    aiService,
  )

  let workflow = await prisma.codingTaskWorkflow.findFirst({ where: { taskId } })
  if (!workflow) {
    workflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId,
        status: 'PLANNING',
        aiService,
        metadata: {
          webhookTriggered: false,
          directAssignment: true,
          startedAt: new Date().toISOString(),
          triggeredByComment: Boolean(userComment),
        },
      },
    })
  }

  const workflowId = workflow.id

  // Fire-and-forget: the run takes minutes and no caller waits for it.
  orchestrator
    .executeCompleteWorkflow(workflowId, taskId)
    .then(() => log.info({ workflowId }, 'Workflow completed'))
    .catch(async (error: Error) => {
      log.error({ err: error, workflowId }, 'Workflow failed')

      try {
        await prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'FAILED',
            metadata: { error: error.message, failedAt: new Date().toISOString() },
          },
        })
      } catch (e) {
        log.error({ err: e }, 'Failed to mark workflow FAILED')
      }

      // This used to POST the failure comment to our own /api/tasks/:id/comments
      // over HTTP, with no cookie — so it 401'd and the user never saw why their
      // workflow died. Same bug as the trigger itself, one layer down. Written
      // directly now.
      try {
        const agent = await prisma.user.findUnique({
          where: { id: aiAgentId },
          select: { id: true },
        })
        await prisma.comment.create({
          data: {
            taskId,
            authorId: agent?.id ?? null,
            content: `❌ **Workflow error**\n\n\`\`\`\n${error.message}\n\`\`\``,
            type: 'MARKDOWN',
          },
        })
      } catch (e) {
        log.error({ err: e }, 'Failed to post workflow error comment')
      }
    })

  return { ok: true, workflowId, taskId }
}
