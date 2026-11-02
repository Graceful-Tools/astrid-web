/**
 * Lists over MCP (AWTD-1491): create a list and set what an agent reads from it.
 *
 * An agent sent to /starthere had no way to build the workspace it describes —
 * the remote MCP surface could read lists but not create one or set its
 * description, which IS the instruction file every agent working the list
 * reads. These are thin proxies over POST /api/v1/lists and
 * PUT /api/v1/lists/:id, which own validation and the owner/admin check.
 *
 * Deliberately NOT exposed here:
 * - `privacy` — every list an agent creates is PRIVATE, and an agent cannot
 *   change visibility. Making a board public exposes every task on it; that is
 *   a person's decision, made in the app.
 * - inviting members — it sends email to a real person.
 * - deleting a list.
 *
 * Both routes require the `lists:write` scope. A token without it gets the
 * route's 403, surfaced as a tool error naming the missing scope.
 *
 * Kept out of `mcp-server-oauth.ts` because that file is on the
 * oversized-files ratchet (same as blockers.ts).
 */

import type { ChatRequester as Requester } from "./list-chat"

const DEFAULT_ASSIGNEE = "Who new tasks in this list are assigned to by default: a user id. To route the list to an agent, pass defaultAgent instead."
const DEFAULT_AGENT =
  'Route new tasks in this list to an agent by its mailbox: "claude", "codex", "copilot", "muse", "gemini" or "openai". Resolved to that agent\'s identity; use instead of defaultAssigneeId.'
const DESCRIPTION =
  "Markdown instructions. Every agent working a task in this list reads this as its instructions, so say what to do, what done means, and what not to do."

export const LIST_TOOLS = [
  {
    name: "create_list",
    description:
      "Create a private list (a board) owned by you. Its description becomes the instructions every agent reads for tasks in it, and defaultAssigneeId routes new tasks to an agent. Share it with people from the app. Requires the lists:write scope.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name, e.g. \"Build\"." },
        description: { type: "string", description: DESCRIPTION },
        defaultAgent: { type: "string", description: DEFAULT_AGENT },
        defaultAssigneeId: { type: "string", description: DEFAULT_ASSIGNEE },
        color: { type: "string", description: "Hex colour, e.g. \"#3b82f6\". Optional." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_list",
    description:
      "Rename a list, rewrite its agent instructions (description), or change its default assignee. Only fields you pass change. You must be the list's owner or an admin. Requires the lists:write scope.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The list to change (from get_lists)." },
        name: { type: "string" },
        description: { type: "string", description: DESCRIPTION },
        defaultAgent: { type: "string", description: DEFAULT_AGENT },
        defaultAssigneeId: {
          type: ["string", "null"],
          description: `${DEFAULT_ASSIGNEE} null means whoever creates the task; "unassigned" means nobody.`,
        },
        color: { type: "string" },
      },
      required: ["listId"],
      additionalProperties: false,
    },
  },
] as const

type ListToolName = (typeof LIST_TOOLS)[number]["name"]

export function isListTool(name: string): name is ListToolName {
  return LIST_TOOLS.some(tool => tool.name === name)
}

/** The fields each tool may forward — anything else is refused, never silently dropped. */
const FORWARDED: Record<ListToolName, readonly string[]> = {
  create_list: ["name", "description", "defaultAssigneeId", "color"],
  update_list: ["name", "description", "defaultAssigneeId", "color"],
}

function pickFields(name: ListToolName, args: Record<string, unknown>): Record<string, unknown> {
  const allowed = FORWARDED[name]
  const unknown = Object.keys(args).filter(k => k !== "listId" && k !== "defaultAgent" && !allowed.includes(k))
  if (unknown.length > 0) {
    throw new Error(`${name} does not accept: ${unknown.join(", ")}`)
  }
  const body: Record<string, unknown> = {}
  for (const key of allowed) {
    if (args[key] !== undefined) body[key] = args[key]
  }
  return body
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`)
  return value.trim()
}

/**
 * The routes answer 403 "Forbidden" for two different reasons — the token
 * lacks lists:write, or the caller is not the list's owner/admin — and the
 * client only sees the word. Name both, so neither reads as a bug.
 */
function explain(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/\bforbidden\b|\b403\b/i.test(message)) {
    throw new Error(
      `${message}: either this connection's token does not carry the lists:write scope, or you are not this list's owner or an admin. Create or edit the list in the app, or reconnect with a token that has lists:write.`,
    )
  }
  throw error instanceof Error ? error : new Error(message)
}

/**
 * Mailbox → that agent's user id, through the queue endpoint the MCP identity
 * code already uses (mcp/agent-identity.ts). Agent user ids are generated, not
 * derived from the mailbox, so they cannot be guessed.
 */
async function resolveAgentId(client: Requester, mailbox: string): Promise<string> {
  const response = (await client.makeRequest(
    `/api/v1/agent-queue?agent=${encodeURIComponent(mailbox)}`,
  )) as { agent?: { mailbox?: string; id?: string | null } }
  const id = response?.agent?.mailbox === mailbox ? response.agent.id : null
  if (!id) {
    throw new Error(
      `The "${mailbox}" agent has no account here yet, so it cannot be a default assignee. Assign it any task once in the app, then retry.`,
    )
  }
  return id
}

async function applyDefaultAgent(client: Requester, args: Record<string, unknown>, body: Record<string, unknown>) {
  if (args.defaultAgent === undefined) return
  if (args.defaultAssigneeId !== undefined) {
    throw new Error("Pass defaultAgent or defaultAssigneeId, not both")
  }
  const mailbox = typeof args.defaultAgent === "string" ? args.defaultAgent.trim().toLowerCase() : ""
  if (!mailbox) throw new Error("defaultAgent must be an agent mailbox such as \"claude\"")
  body.defaultAssigneeId = await resolveAgentId(client, mailbox)
}

export async function callListTool(client: Requester, name: ListToolName, rawArgs: unknown) {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>
  let data: unknown

  try {
    if (name === "create_list") {
      const body = pickFields(name, args)
      body.name = requireString(args, "name")
      await applyDefaultAgent(client, args, body)
      // Visibility is a person's decision; an agent's list always starts private.
      body.privacy = "PRIVATE"
      data = await client.makeRequest("/api/v1/lists", { method: "POST", body: JSON.stringify(body) })
    } else {
      const listId = requireString(args, "listId")
      const body = pickFields(name, args)
      await applyDefaultAgent(client, args, body)
      if (Object.keys(body).length === 0) {
        throw new Error("update_list needs at least one of: name, description, defaultAgent, defaultAssigneeId, color")
      }
      data = await client.makeRequest(`/api/v1/lists/${encodeURIComponent(listId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      })
    }
  } catch (error) {
    explain(error)
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, ...(data as object) }, null, 2) }],
  }
}
