/**
 * gather_decision_evidence over MCP (ADEV-181): the brief for filling a decision task's traffic
 * light with sourced assessments. Read-only; the agent writes the result back with update_task or
 * add_comment. Kept out of mcp-server-oauth.ts, which is on the oversized-files ratchet.
 */
import { buildEvidenceBrief } from '../lib/decision-evidence'
import { hasGoalsOrGuardrails, storedGoalsAndGuardrails, type GoalsAndGuardrails } from '../lib/goals-guardrails'
import type { ChatRequester as Requester } from './list-chat'

export const DECISION_EVIDENCE_TOOLS = [
  {
    name: 'gather_decision_evidence',
    description:
      'Get the brief for gathering evidence on a decision task: its trade-off grid (criteria, options, cells with no evidence yet), the project goals and guardrails, and the rules for filling it. Follow the brief: propose missing options (keep Do nothing), fill each cell with a concrete, sourced assessment, leave unsupported cells as ~ "unknown", and end with a Decision for the owner. You propose; you do not decide.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'The decision task: id (uuid) or identifier such as ADEV-12.' } },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
] as const

export const isDecisionEvidenceTool = (name: string) => DECISION_EVIDENCE_TOOLS.some(tool => tool.name === name)

export async function callDecisionEvidenceTool(client: Requester, rawArgs: unknown) {
  const taskId = ((rawArgs as { taskId?: unknown } | null)?.taskId as string | undefined)?.trim()
  if (!taskId) throw new Error('Pass taskId')
  const { task } = await client.makeRequest<{
    task?: { identifier?: string; title?: string; description?: string; listIds?: string[] }
  }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
  if (!task?.title) throw new Error('Task not found')

  let goals: GoalsAndGuardrails | null = null
  const listId = task.listIds?.[0]
  if (listId) {
    const stored = await client
      .makeRequest(`/api/v1/lists/${encodeURIComponent(listId)}/goals`)
      .then(storedGoalsAndGuardrails, () => null)
    if (stored && hasGoalsOrGuardrails(stored)) goals = stored
  }
  const text = buildEvidenceBrief({ identifier: task.identifier, title: task.title, description: task.description, goals })
  return { content: [{ type: 'text' as const, text }] }
}
