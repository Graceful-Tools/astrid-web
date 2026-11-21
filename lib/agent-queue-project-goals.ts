/**
 * A polling agent's project goals and guardrails (ADEV-179).
 *
 * Webhook and server-run agents get them in their prompt; a polling agent gets them here, with the
 * queue, one entry per queued task's first list whose project states any (the lists agents take
 * guidance from, keyed the same way as listInstructions). Written by project owners, so the markdown form is wrapped as
 * untrusted guidance (lib/ai/prompt-trust.ts).
 */
import { goalsForLists } from '@/services/project-goals.service'
import { wrapUntrustedProjectGoals } from '@/lib/ai/prompt-trust'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

export interface AgentProjectGoals extends GoalsAndGuardrails {
  /**
   * The queued task list this entry is for. Entries are keyed by list, like listInstructions, so a
   * client finds its task's goals by the task's first list (ADEV-190); two lists in one project
   * get one entry each.
   */
  listId: string
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
  return found.flatMap(({ projectId, projectName, value, listIds: inProject }) => {
    const instructions = wrapUntrustedProjectGoals(value)
    return inProject.map(listId => ({ listId, projectId, projectName, ...value, instructions }))
  })
}
