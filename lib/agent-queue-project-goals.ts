/**
 * A polling agent's project goals and guardrails (ADEV-179).
 *
 * Webhook and server-run agents get them in their prompt; a polling agent gets them here, with the
 * queue, one entry per project of the queued tasks' first lists (the lists agents take guidance
 * from, as listInstructions does). Written by project owners, so the markdown form is wrapped as
 * untrusted guidance (lib/ai/prompt-trust.ts).
 */
import { goalsForLists } from '@/services/project-goals.service'
import { wrapUntrustedProjectGoals } from '@/lib/ai/prompt-trust'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

export interface AgentProjectGoals extends GoalsAndGuardrails {
  projectId: string
  projectName: string
  /** The same goals as markdown, wrapped as untrusted guidance the way listInstructions is. */
  instructions: string
}

/**
 * Goals steer the work; they never gate it, so a read that fails leaves them out rather than
 * failing the poll. Empty when no queued task's project states any.
 */
export async function collectProjectGoals(tasks: Array<{ lists: Array<{ id: string }> }>): Promise<AgentProjectGoals[]> {
  if (!tasks.length) return []
  const listIds = tasks.map(task => task.lists[0]?.id).filter((id): id is string => !!id)
  const found = await goalsForLists(listIds).catch(() => [])
  return found.map(({ projectId, projectName, value }) => ({ projectId, projectName, ...value, instructions: wrapUntrustedProjectGoals(value) }))
}
