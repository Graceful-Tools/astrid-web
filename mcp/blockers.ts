/**
 * "Waiting on" over MCP (AWTD-1086).
 *
 * Blockers have had a v1 API since AWTD-1002 and no MCP tool, so an agent could
 * read `blockedBy` through get_task and not set it — the only way left to park
 * a task on another was a `BLOCKED-BY:` comment line, which the queue sweep
 * honours but the task's "Waiting on" row and the iOS app never show.
 *
 * Thin proxies: the routes own access, cycle refusal, and the Ready ⇄ Waiting
 * lane move, so none of that is restated here. Kept out of
 * `mcp-server-oauth.ts` because that file is on the oversized-files ratchet.
 */

import type { ChatRequester as Requester } from "./list-chat"

const TASK_REF = "Task id (uuid) or identifier such as AWTD-1007"

export const BLOCKER_TOOLS = [
  {
    name: "add_blocker",
    description:
      "Mark a task as waiting on another task (\"Waiting on\" in the app). Idempotent. A Ready task moves to Waiting while the blocker is open, and returns to Ready by itself when every blocker is complete — use this instead of a BLOCKED-BY comment line. Refused (409) if it would make two tasks wait for each other.",
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
      "Stop a task waiting on another task. Removing the last open blocker returns a Waiting task to Ready, exactly as completing that blocker would.",
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
] as const

type BlockerToolName = (typeof BLOCKER_TOOLS)[number]["name"]

export function isBlockerTool(name: string): name is BlockerToolName {
  return BLOCKER_TOOLS.some(tool => tool.name === name)
}

function requireRef(args: any, key: "taskId" | "blockingTaskId"): string {
  const value = args?.[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`)
  return value.trim()
}

export async function callBlockerTool(client: Requester, name: BlockerToolName, args: any) {
  const taskId = requireRef(args, "taskId")
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
