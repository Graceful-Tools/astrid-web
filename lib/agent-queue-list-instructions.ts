/**
 * A polling agent's list instructions (AWTD-1689).
 *
 * A list's description is its agent instructions. Webhook and server-run agents
 * get it in their payload; a polling agent gets it here, with the queue, so an
 * owner who edits the instructions is not ignored just because the agent never
 * thought to call get_lists. It is user-authored, so it is wrapped as untrusted
 * guidance exactly as the webhook path wraps it (lib/ai/prompt-trust.ts), and
 * sent once per list rather than once per task.
 */

import { wrapUntrustedListGuidance, wrapUntrustedProjectGoals } from '@/lib/ai/prompt-trust'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'
import { goalsByListId } from '@/services/goals-guardrails.service'

/**
 * Most characters of one list's description a poll will carry. The response
 * holds at most one entry per queued list, so its instruction text is bounded
 * by this times the number of lists on the page.
 */
export const LIST_INSTRUCTIONS_MAX_CHARS = 4000

export interface AgentListInstructions {
  listId: string
  listName: string
  instructions: string
  /** True when the description was cut at LIST_INSTRUCTIONS_MAX_CHARS. */
  truncated: boolean
}

/** One entry per list that carries instructions, read from each task's first list. */
export function collectListInstructions(
  tasks: Array<{ lists: Array<{ id: string; name: string; description?: string | null }> }>
): AgentListInstructions[] {
  const byList = new Map<string, AgentListInstructions>()
  for (const { lists } of tasks) {
    const list = lists[0]
    const text = list?.description?.trim()
    if (!list || !text || byList.has(list.id)) continue
    const truncated = text.length > LIST_INSTRUCTIONS_MAX_CHARS
    byList.set(list.id, {
      listId: list.id,
      listName: list.name,
      instructions: wrapUntrustedListGuidance(truncated ? text.slice(0, LIST_INSTRUCTIONS_MAX_CHARS) : text),
      truncated,
    })
  }
  return [...byList.values()]
}

/**
 * The named board's project goals and guardrails (ADEV-179), beside the list instructions: what
 * the project is trying to achieve and must not do. `text` is the block to put in a prompt,
 * wrapped as untrusted data.
 */
export interface AgentProjectGoals {
  listId: string
  goals: GoalsAndGuardrails
  text: string
}

/** `{ projectGoals: [...] }` for a list whose project states goals, else nothing to spread. */
export async function projectGoalsField(listId: string): Promise<{ projectGoals?: AgentProjectGoals[] }> {
  const goals = (await goalsByListId([listId])).get(listId)
  return goals ? { projectGoals: [{ listId, goals, text: wrapUntrustedProjectGoals(goals) }] } : {}
}
