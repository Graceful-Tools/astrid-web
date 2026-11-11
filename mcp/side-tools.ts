/**
 * Dispatch for the MCP tools that live in their own modules — blockers,
 * attachments, lists — so `mcp-server-oauth.ts` (on the oversized-files
 * ratchet) carries one line for all of them instead of one per family.
 *
 * Returns null for a name none of them own, so the caller can still report
 * "Unknown tool".
 */

import { callBlockerTool, isBlockerTool } from "./blockers"
import { callListTool, isListTool } from "./list-tools"
import { callAttachmentTool, isAttachmentTool } from "./task-attachments"
import { callClaimTaskTool } from "./claim-task-tool"
import type { ChatRequester } from "./list-chat"
import type { OAuthAPIClient } from "./oauth-api-client"

type Requester = ChatRequester & Pick<OAuthAPIClient, "claimTask">

export async function callSideTool(
  client: Requester,
  name: string,
  args: unknown,
  signature: Parameters<typeof callAttachmentTool>[2],
) {
  if (name === "claim_task") return callClaimTaskTool(client, args)
  if (isBlockerTool(name)) return callBlockerTool(client, name, args)
  if (isListTool(name)) return callListTool(client, name, args)
  if (isAttachmentTool(name)) return callAttachmentTool(client as Parameters<typeof callAttachmentTool>[0], args, signature)
  return null
}
