import type { OAuthAPIClient } from "./oauth-api-client"

type ClaimTaskClient = Pick<OAuthAPIClient, "claimTask">

export async function callClaimTaskTool(client: ClaimTaskClient, args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("taskId is required")
  }

  const input = args as { taskId?: unknown; action?: unknown; agent?: unknown }
  if (typeof input.taskId !== "string" || !input.taskId) {
    throw new Error("taskId is required")
  }
  if (input.action !== "claim" && input.action !== "resume" && input.action !== "release" && input.action !== "heartbeat") {
    throw new Error("action must be claim, resume, release, or heartbeat")
  }
  if (input.agent !== undefined && typeof input.agent !== "string") {
    throw new Error("agent must be a mailbox name")
  }

  const data = await client.claimTask(input.taskId, {
    action: input.action,
    ...(input.agent ? { agentMailbox: input.agent } : {}),
  })
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}
