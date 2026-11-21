/**
 * get_project_goals over MCP (ADEV-179): what a project is trying to achieve and what it must not
 * do, read from the stored value rather than from prompt text.
 *
 * A thin proxy over GET /api/v1/lists/:id/goals, which owns permissions. With a taskId it reads
 * the task's lists and answers each one. Read-only: a person states goals, in project settings
 * (the route refuses agents). Kept out of mcp-server-oauth.ts, which is on the oversized-files ratchet.
 */
import type { ChatRequester as Requester } from './list-chat'
import { formatGoalsForAgent, type GoalsAndGuardrails } from '../lib/goals-guardrails'

export const PROJECT_GOALS_TOOLS = [
  {
    name: 'get_project_goals',
    description:
      'Read the goals and guardrails of the project a list or task belongs to. Goals say what the project is trying to achieve (with a measure, target and current reading when it has one); work toward them. Guardrails say what it must not do: "stated" ones you judge yourself, "enforced" ones the system also checks. Stay inside every guardrail, and if the task cannot be done inside them, stop and ask a person. An empty answer means the project states none.',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'The list (board) you are working from.' },
        taskId: { type: 'string', description: 'A task id or identifier such as AWTD-1007. Answers every list the task is on.' },
      },
      additionalProperties: false,
    },
  },
] as const

type ToolName = (typeof PROJECT_GOALS_TOOLS)[number]['name']

export function isProjectGoalsTool(name: string): name is ToolName {
  return PROJECT_GOALS_TOOLS.some(tool => tool.name === name)
}

interface ListGoals { listId: string; projectId: string | null; goals: GoalsAndGuardrails | null }

const goalsUrl = (listId: string) => `/api/v1/lists/${encodeURIComponent(listId)}/goals`

/** The route's own `text` is for prompts; this keeps the tool correct against an older server too. */
const withText = (view: ListGoals) => ({ ...view, text: formatGoalsForAgent(view.goals) })

export async function callProjectGoalsTool(client: Requester, _name: ToolName, rawArgs: unknown) {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const listId = typeof args.listId === 'string' ? args.listId.trim() : ''
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (!listId && !taskId) throw new Error('Pass listId or taskId')

  let data: unknown
  if (listId) {
    data = withText(await client.makeRequest<ListGoals>(goalsUrl(listId)))
  } else {
    const { task } = await client.makeRequest<{ task?: { id?: string; listIds?: string[] } }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    )
    const listIds = task?.listIds ?? []
    if (listIds.length === 0) throw new Error('This task is on no list, so no project goals apply')
    const lists = await Promise.all(listIds.map(id => client.makeRequest<ListGoals>(goalsUrl(id))))
    data = { taskId: task?.id ?? taskId, lists: lists.map(withText) }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
