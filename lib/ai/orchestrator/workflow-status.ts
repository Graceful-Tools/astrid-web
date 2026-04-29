import { prisma } from '../../prisma'

/**
 * Verify a coding-task workflow is still alive and progressing — call this
 * before each long-running phase so a cancelled or task-deleted workflow
 * doesn't run to completion.
 *
 * Throws on any non-runnable state (workflow missing, cancelled, task
 * completed/deleted). Callers in ai-orchestrator catch + handle by writing
 * the failure status via `handleWorkflowError`.
 */
export async function checkWorkflowStatus(workflowId: string): Promise<void> {
  const workflow = await prisma.codingTaskWorkflow.findUnique({
    where: { id: workflowId },
    include: { task: true },
  })

  if (!workflow) {
    throw new Error('Workflow not found - may have been deleted')
  }
  if (workflow.status === 'CANCELLED') {
    throw new Error('Workflow has been cancelled')
  }
  if (workflow.task?.completed) {
    throw new Error('Task has been marked as completed')
  }
  if (!workflow.task) {
    throw new Error('Task has been deleted')
  }
}

/**
 * Set a workflow's status (PLANNING, IMPLEMENTING, AWAITING_APPROVAL, etc).
 * Status is typed as string here because the Prisma enum changes faster than
 * the orchestrator wants to track; the call sites already pass valid values.
 */
export async function updateWorkflowStatus(workflowId: string, status: string): Promise<void> {
  await prisma.codingTaskWorkflow.update({
    where: { id: workflowId },
     
    data: { status: status as any },
  })
}

/**
 * Mark a workflow as FAILED with the failure step + error context recorded
 * in metadata so the run can be triaged later.
 */
export async function handleWorkflowError(
  workflowId: string,
  step: string,
   
  error: any,
): Promise<void> {
  await prisma.codingTaskWorkflow.update({
    where: { id: workflowId },
    data: {
      status: 'FAILED',
      metadata: {
        error: error?.message ?? String(error),
        step,
        timestamp: new Date().toISOString(),
      },
    },
  })
}
