import { prisma } from '../../prisma'
import { createLogger } from '../../logger'
import type { ImplementationPlan } from '../types'

const log = createLogger('ai-orchestrator/planning-context')

/**
 * The shape we persist into Prisma.codingTaskWorkflow.metadata.planningContext.
 * Kept loose because Prisma's Json field is `any` at the type boundary.
 */
export interface SerializedPlanningContext {
  plan: ImplementationPlan
  exploredFiles: Array<{
    path: string
    content: string
    relevance: string
    timestamp: number
  }>
  astridMdContent?: string
  timestamp: number
}

/**
 * Persist the planning phase's context into the workflow row so the
 * implementation phase can pick it up without re-running file exploration.
 *
 * Best-effort: a write failure logs but doesn't throw — losing the cache
 * just means slower implementation, not an aborted workflow.
 */
export async function storePlanningContext(args: {
  taskId: string
  plan: ImplementationPlan
  exploredFiles: Map<string, { content: string; timestamp: number }>
  astridMdContent?: string
}): Promise<void> {
  const { taskId, plan, exploredFiles, astridMdContent } = args

  try {
    const serializedExplored = Array.from(exploredFiles.entries()).map(
      ([path, data]) => ({
        path,
        content: data.content,
        relevance: 'Explored during planning',
        timestamp: data.timestamp,
      }),
    )

    await prisma.codingTaskWorkflow.updateMany({
      where: { taskId },
      data: {
        metadata: {
          planningContext: {
            plan,
            exploredFiles: serializedExplored,
            astridMdContent,
            timestamp: Date.now(),
          },
           
        } as any,
      },
    })

    log.info(
      {
        taskId,
        exploredFilesCount: serializedExplored.length,
        hasAstridMd: !!astridMdContent,
      },
      'Stored planning context for implementation phase',
    )
  } catch (error) {
    log.error(
      { taskId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to store planning context',
    )
  }
}

/**
 * Read the most recent planning context for a task. Returns null if no
 * workflow row exists, no metadata, or no planningContext key.
 *
 * Errors are swallowed (returned as null + logged) for the same reason as
 * the writer — a missing cache shouldn't fail the workflow.
 */
export async function loadPlanningContext(args: {
  taskId: string
   
}): Promise<any | null> {
  const { taskId } = args

  try {
    const workflow = await prisma.codingTaskWorkflow.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })

    if (!workflow || !workflow.metadata) {
      log.warn({ taskId }, 'No workflow or metadata found for task')
      return null
    }

     
    const metadata = workflow.metadata as any
    const planningContext = metadata.planningContext

    if (!planningContext) {
      log.warn({ taskId }, 'No planning context found in workflow metadata')
      return null
    }

    log.info(
      {
        taskId,
        exploredFilesCount: planningContext.exploredFiles?.length || 0,
        hasAstridMd: !!planningContext.astridMdContent,
      },
      'Loaded planning context from workflow',
    )

    return planningContext
  } catch (error) {
    log.error(
      { taskId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to load planning context',
    )
    return null
  }
}
