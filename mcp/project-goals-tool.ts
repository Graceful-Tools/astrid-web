/**
 * get_project_goals over MCP (ADEV-179): the goals and guardrails of the project an agent works in.
 *
 * A thin proxy over GET /api/v1/lists/:id/goals (or /api/v1/projects/:id/goals), which own the
 * permissions. With a taskId it reads the task's first list, the one agents take guidance from.
 *
 * Read-only. Guardrails bound what agents do, so changing them is a person's call: an agent that
 * infers goals proposes them in a Decision, and the project owner saves them in settings (the route
 * refuses agents). Kept out of mcp-server-oauth.ts, which is on the oversized-files ratchet.
 */
import type { ChatRequester as Requester } from './list-chat'

export const PROJECT_GOALS_TOOLS = [
  {
    name: 'get_project_goals',
    description:
      "Read the goals and guardrails of the project a list or task is in. Goals say what the work is for (each may carry a measure, a target and the current value); guardrails say what it must not do. A guardrail is \"stated\" (you judge it) or \"enforced\" (a program checks it). Work toward the goals and stay inside the guardrails; when a choice is unclear, prefer the option that serves the goals, and name the goal id your work served in your summary. Use the goals as criteria in a trade-off grid, and rate an option that breaks a guardrail -- (disqualifying). An agent cannot change them: propose changes to the project owner in a Decision. A list in no project has none.",
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'The list (board) you are working from.' },
        projectId: { type: 'string', description: 'The project, when you have its id.' },
        taskId: { type: 'string', description: "A task id or identifier such as AWTD-1007; reads its first list's project." },
      },
      additionalProperties: false,
    },
  },
] as const

type ToolName = (typeof PROJECT_GOALS_TOOLS)[number]['name']

export function isProjectGoalsTool(name: string): name is ToolName {
  return PROJECT_GOALS_TOOLS.some(tool => tool.name === name)
}

export async function callProjectGoalsTool(client: Requester, _name: ToolName, rawArgs: unknown) {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const pick = (key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '')
  const projectId = pick('projectId')
  let listId = pick('listId')
  const taskId = pick('taskId')
  if (!projectId && !listId && !taskId) throw new Error('Pass listId, projectId or taskId')

  let data: unknown
  if (projectId) {
    data = await client.makeRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/goals`)
  } else {
    if (!listId) {
      const { task } = await client.makeRequest<{ task?: { listIds?: string[] } }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
      listId = task?.listIds?.[0] ?? ''
      if (!listId) throw new Error('This task is on no list, so no project goals apply')
    }
    data = await client.makeRequest(`/api/v1/lists/${encodeURIComponent(listId)}/goals`)
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
