import { createAIAgentComment } from '../../ai-agent-comment-service'
import { prisma } from '../../prisma'
import { createLogger } from '../../logger'
import {
  formatPlanComment,
  formatPlanSummary,
  formatImplementationComment,
  formatCompletionSummary,
  type ImplementationDetails,
} from '../workflow-comments'
import type { ImplementationPlan } from '../types'

const log = createLogger('ai-orchestrator/comment-poster')

/**
 * Post a status comment (title + body) to the AI agent's running task.
 *
 * `traceId` is forwarded into log lines so failures can be correlated with
 * the surrounding orchestrator run; pass orchestrator.getTraceId() at the
 * call site.
 */
export async function postStatusComment(
  taskId: string,
  title: string,
  message: string,
  traceId?: string,
): Promise<void> {
  const result = await createAIAgentComment(taskId, `${title}\n\n${message}`)
  if (!result.success) {
    log.error({ taskId, traceId, error: result.error }, 'Failed to post status comment')
  }
}

/**
 * Post the formatted plan as a comment, persist the plan into workflow
 * metadata, and best-effort mirror a summary to the Astrid MCP task.
 */
export async function postPlanComment(
  taskId: string,
  plan: ImplementationPlan,
  traceId?: string,
): Promise<void> {
  const planComment = formatPlanComment(plan)
  const result = await createAIAgentComment(taskId, planComment)
  if (!result.success) {
    log.error({ taskId, traceId, error: result.error }, 'Failed to post plan comment')
  }

  await prisma.codingTaskWorkflow.updateMany({
    where: { taskId },
     
    data: { metadata: { plan: plan as any } },
  })

  // MCP mirror is optional — never fail the workflow if it can't reach.
  try {
    await postToAstridTask(taskId, formatPlanSummary(plan))
  } catch {
    /* MCP optional */
  }
}

/**
 * Post the implementation completion comment + best-effort MCP mirror.
 */
export async function postImplementationComment(
  taskId: string,
  details: ImplementationDetails,
  traceId?: string,
): Promise<void> {
  const result = await createAIAgentComment(taskId, formatImplementationComment(details))
  if (!result.success) {
    log.error({ taskId, traceId, error: result.error }, 'Failed to post implementation comment')
  }

  try {
    await postToAstridTask(taskId, formatCompletionSummary(details))
  } catch {
    /* MCP optional */
  }
}

/**
 * Mirror updates to the Astrid MCP task per CLAUDE.md best practices.
 *
 * Currently a no-op placeholder — would shell out to
 * `npx tsx scripts/add-task-comment.ts` once the MCP integration is wired.
 * Kept here so callers can begin to depend on the surface today.
 */
export async function postToAstridTask(_taskId: string, _content: string): Promise<void> {
  // Intentionally empty — see docstring.
}
