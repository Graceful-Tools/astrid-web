/**
 * "Waiting on" over MCP (AWTD-1086).
 *
 * Blockers have had a v1 API since AWTD-1002 and no MCP tool, so an agent could
 * read `blockedBy` through get_task and not set it — the only way left to park
 * a task on another was a `BLOCKED-BY:` comment line, which the queue sweep
 * honours but the task's "Waiting on" row and the iOS app never show.
 *
 * `handoff_task` (AWTD-1686) is the one-step version for handing work to another
 * board: file the other half there, wait on it, and get the task back when it
 * is done — POST /api/v1/tasks/:id/handoff.
 *
 * Thin proxies: the routes own access, cycle refusal, and the Ready ⇄ Waiting
 * lane move, so none of that is restated here. Kept out of
 * `mcp-server-oauth.ts` because that file is on the oversized-files ratchet.
 */

import { AGENT_WRITE_DESCRIPTION } from "./agent-identity"
import type { ChatRequester as Requester } from "./list-chat"

const TASK_REF = "Task id (uuid) or identifier such as AWTD-1007"

export const BLOCKER_TOOLS = [
  {
    name: "add_blocker",
    description:
      "Mark a task as waiting on another task (\"Waiting on\" in the app). Idempotent. A Ready task given an open blocker moves to Waiting (and is unassigned, as every move into Waiting is). The server wakes it back to Ready by itself — on the blocker's completion, and in its scheduled settle job — once every blocker is complete and any date has come; no client or agent sweep is needed. Use this instead of a BLOCKED-BY comment line. Refused (409) if it would make two tasks wait for each other.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: `The task that waits. ${TASK_REF}` },
        blockingTaskId: { type: "string", description: `The task it waits on. ${TASK_REF}` },
      },
      required: ["taskId", "blockingTaskId"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_blocker",
    description:
      "Stop a task waiting on another task. Removing the last open condition of a Waiting task (no other open blocker, no future date) wakes it to Ready on the server, exactly as completing that blocker would.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: `The task that waits. ${TASK_REF}` },
        blockingTaskId: { type: "string", description: `The task it no longer waits on. ${TASK_REF}` },
      },
      required: ["taskId", "blockingTaskId"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_task",
    description:
      "Hand a task's other half to another list, in one step: creates the half in Ready on targetListId, makes this task wait on it (Waiting), and remembers who held this task. When the half is completed, the server wakes this task to Ready assigned back to that same person or agent — it reappears in your own queue, no includeUnassigned needed. Use this instead of create_task + add_blocker when work belongs to another board (e.g. the iOS half of a web task). Needs write access to this task and permission to add tasks to the target list. Refused (409 HANDOFF_SOURCE_DONE) for a finished task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: `The task being handed off. ${TASK_REF}` },
        targetListId: { type: "string", description: "The list to file the other half on" },
        title: { type: "string", description: "The other half's title" },
        description: { type: "string", description: "The other half's description: the contract, the evidence, and what this side does once it exists" },
        priority: { type: "number", description: "0-3 (default: the create default)" },
        assigneeId: { type: "string", description: "Assign the half to this user or agent. Omit to leave it unassigned for the target board's queue" },
        agent: { type: "string", description: AGENT_WRITE_DESCRIPTION },
      },
      required: ["taskId", "targetListId", "title"],
      additionalProperties: false,
    },
  },
] as const

type BlockerToolName = (typeof BLOCKER_TOOLS)[number]["name"]

export function isBlockerTool(name: string): name is BlockerToolName {
  return BLOCKER_TOOLS.some(tool => tool.name === name)
}

function requireRef(args: any, key: "taskId" | "blockingTaskId" | "targetListId" | "title"): string {
  const value = args?.[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`)
  return value.trim()
}

export async function callBlockerTool(
  client: Requester,
  name: BlockerToolName,
  args: any,
  signFor: (agent: string | undefined) => Promise<{ aiAgentId?: string }>,
) {
  const taskId = requireRef(args, "taskId")
  if (name === "handoff_task") {
    const body: Record<string, unknown> = {
      ...(await signFor(args?.agent)),
      targetListId: requireRef(args, "targetListId"),
      title: requireRef(args, "title"),
    }
    if (typeof args?.description === "string") body.description = args.description
    if (typeof args?.priority === "number") body.priority = args.priority
    if (typeof args?.assigneeId === "string" && args.assigneeId) body.assigneeId = args.assigneeId
    const data = await client.makeRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}/handoff`, {
      method: "POST",
      body: JSON.stringify(body),
    })
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, ...(data as object) }, null, 2) }],
    }
  }
  const blockingTaskId = requireRef(args, "blockingTaskId")
  const blockers = `/api/v1/tasks/${encodeURIComponent(taskId)}/blockers`

  const data =
    name === "add_blocker"
      ? await client.makeRequest(blockers, { method: "POST", body: JSON.stringify({ blockingTaskId }) })
      : await client.makeRequest(`${blockers}/${encodeURIComponent(blockingTaskId)}`, {
          method: "DELETE",
        })

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, ...(data as object) }, null, 2) }],
  }
}
