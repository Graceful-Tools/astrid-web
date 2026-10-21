/**
 * The v1 API response shapes this MCP server reads (AWTD-1311).
 *
 * Three `interface` declarations describing what `/api/v1` ANSWERS, not what
 * this server does. They came out of mcp/mcp-server-oauth.ts when adding the
 * `agent` field pushed that file past its recorded size in
 * tests/rules/oversized-files-ratchet.test.ts — whose rule is to take the next
 * piece out rather than raise the number.
 *
 * They are the right piece to take: a response shape is shared vocabulary, and
 * the next module that reads a task over this API should not re-describe one.
 * Loose on purpose (`comments?: any[]`, `priority: number`) because they
 * document what arrives rather than constrain what may be sent — the Zod
 * schemas in ./task-schemas do the constraining.
 */

export interface Task {
  id: string
  title: string
  description?: string | null
  priority: number
  completed: boolean
  dueDateTime?: string | null
  createdAt: string
  updatedAt: string
  assignee?: { id: string; name: string; email: string } | null
  creator?: { id: string; name: string; email: string } | null
  comments?: any[]
}

export interface TaskList {
  id: string
  name: string
  description?: string | null
  color?: string | null
  privacy: string
  owner?: { id: string; name: string; email: string }
}

export interface Comment {
  id: string
  content: string
  type: string
  createdAt: string
  author: { id: string; name: string; email: string }
}
