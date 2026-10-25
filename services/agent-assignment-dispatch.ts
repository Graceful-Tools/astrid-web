/**
 * Tell an AI agent it has been assigned a task — the one implementation, for
 * task create and task update.
 *
 * There used to be two. Create called the notifier
 * (lib/webhooks/task-assignment-notifier.ts, which knows polling mode, custom
 * agents, user webhooks and the assistant workflow). Update relied on a
 * `$extends` hook in lib/prisma.ts that fired on any raw
 * `task.update({ assigneeId })`, handled only "coding" agent types, and ignored
 * polling mode — so assigning the default assistant to an existing task
 * notified nobody, while a raw assignee write anywhere started a billable run
 * (AWTD-1089). Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §5.2 step 3.
 *
 * Never throws: a failed notification must not fail the write that caused it.
 */

import { prisma } from '@/lib/prisma'
import { aiAgentWebhookService } from '@/lib/ai-agent-webhook-service'
import { runAfterResponse } from '@/lib/background'
import { createLogger } from '@/lib/logger'

const log = createLogger('agent-assignment-dispatch')

export interface AgentAssignmentArgs {
  taskId: string
  assigneeId: string | null
  /** The assignee before this write. Omitted on create. */
  previousAssigneeId?: string | null
  /** The assignee row when the caller already has it; looked up otherwise. */
  assignee?: { isAIAgent?: boolean | null } | null
  /** Legacy direct AIAgent assignment, used only when there is no assignee. */
  aiAgentId?: string | null
  /**
   * Run after the response flushes. An update must: the notifier can reach the
   * assistant workflow, a full model call. A bare floating promise is frozen
   * when the response ends (task 9b794349), hence runAfterResponse.
   */
  deferred?: boolean
}

export async function dispatchAgentAssignment(args: AgentAssignmentArgs): Promise<void> {
  try {
    const notify = await resolveNotification(args)
    if (!notify) return
    if (args.deferred) {
      runAfterResponse('task-assignee-change', () => notify().catch(logFailure))
    } else {
      await notify()
    }
  } catch (err) {
    logFailure(err)
  }
}

async function resolveNotification(args: AgentAssignmentArgs): Promise<(() => Promise<unknown>) | null> {
  const { taskId, assigneeId, previousAssigneeId, aiAgentId } = args

  if (assigneeId) {
    if (assigneeId === previousAssigneeId) return null
    const assignee =
      args.assignee ??
      (await prisma.user.findUnique({ where: { id: assigneeId }, select: { isAIAgent: true } }))
    if (!assignee?.isAIAgent) return null
    return () => aiAgentWebhookService.notifyTaskAssignment(taskId, assigneeId)
  }

  if (aiAgentId && previousAssigneeId === undefined) {
    return () => aiAgentWebhookService.notifyTaskAssignmentViaAIAgentId(taskId, aiAgentId)
  }
  return null
}

function logFailure(err: unknown) {
  log.error({ err }, 'Failed to notify AI agent about task assignment')
}
