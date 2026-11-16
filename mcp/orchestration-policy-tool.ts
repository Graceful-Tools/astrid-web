/**
 * get_orchestration_policy over MCP (AWTD-1693): what an agent may do on a board, read from the
 * stored policy rather than from prompt text.
 *
 * A thin proxy over GET /api/v1/lists/:id/orchestration-policy, which owns permissions and asks
 * astrid-core to resolve the policy. With a taskId it reads the task's lists and answers each one.
 * Every action happens on one board, so an agent uses the list it is working from. If it has no
 * list in hand, it takes the strictest answer across them (astrid-core docs/ORCHESTRATION_POLICY.md
 * §8.3), and `strictest` says so for each action.
 *
 * Read-only. Writing a policy is a person's decision, made in settings (the route refuses agents).
 * Kept out of mcp-server-oauth.ts, which is on the oversized-files ratchet.
 */
import type { ChatRequester as Requester } from './list-chat'
import {
  AUTONOMY_FIELDS,
  autonomyFor,
  stricterAutonomy,
  type Autonomy,
  type AutonomyField,
  type OrchestrationPolicy,
} from '../lib/orchestration-policy'

export const ORCHESTRATION_TOOLS = [
  {
    name: 'get_orchestration_policy',
    description:
      'Read the orchestration policy for a list or a task: who takes unassigned Ready work (routing), what you may do alone (autonomy: merge, deploy, migrate additive/destructive, release, spend, each "allowed", "ask" or "never"), and who to ask (escalation). Read it before merging, deploying, migrating, releasing or spending. "allowed" means do it once the gates are green. "ask" means post the question to the escalation target and wait. "never" means leave it for a person. A migration whose kind you do not know counts as destructive. With nothing stored, every action is "never".',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'The list (board) you are working from.' },
        taskId: {
          type: 'string',
          description: 'A task id or identifier such as AWTD-1007. Answers every list the task is on, and the strictest autonomy across them.',
        },
      },
      additionalProperties: false,
    },
  },
] as const

type ToolName = (typeof ORCHESTRATION_TOOLS)[number]['name']

export function isOrchestrationTool(name: string): name is ToolName {
  return ORCHESTRATION_TOOLS.some(tool => tool.name === name)
}

interface ListPolicy { listId: string; effective: OrchestrationPolicy }

function policyUrl(listId: string) {
  return `/api/v1/lists/${encodeURIComponent(listId)}/orchestration-policy`
}

/** The strictest answer per autonomy field across several lists' effective policies. */
export function strictestAutonomy(policies: OrchestrationPolicy[]): Record<AutonomyField, Autonomy> {
  return Object.fromEntries(
    AUTONOMY_FIELDS.map(field => [field, policies.map(policy => autonomyFor(policy, field)).reduce(stricterAutonomy, 'allowed' as Autonomy)]),
  ) as Record<AutonomyField, Autonomy>
}

export async function callOrchestrationTool(client: Requester, _name: ToolName, rawArgs: unknown) {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const listId = typeof args.listId === 'string' ? args.listId.trim() : ''
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (!listId && !taskId) throw new Error('Pass listId or taskId')

  let data: unknown
  if (listId) {
    data = await client.makeRequest(policyUrl(listId))
  } else {
    const { task } = await client.makeRequest<{ task?: { id?: string; listIds?: string[] } }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    )
    const listIds = task?.listIds ?? []
    if (listIds.length === 0) {
      throw new Error('This task is on no list, so no orchestration policy applies; every action is left for a person')
    }
    const lists = await Promise.all(listIds.map(id => client.makeRequest<ListPolicy>(policyUrl(id))))
    data = {
      taskId: task?.id ?? taskId,
      lists,
      ...(lists.length > 1 ? { strictest: strictestAutonomy(lists.map(list => list.effective)) } : {}),
    }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
