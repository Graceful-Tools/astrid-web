/**
 * Who the MCP server is writing AS (AWTD-878).
 *
 * `POST /api/v1/tasks/:id/comments` takes an optional `aiAgentId` and, after
 * checking it names a real AI-agent user, signs the comment with it. The repo's
 * scripts have always sent one — scripts/post-session-link.ts and
 * scripts/add-task-comment.ts both pass `CLAUDE_AGENT_ID`. The MCP server did
 * not, so every comment the /fixall loop wrote through it was signed with the
 * OAuth client owner's name and face: the board showed Jon writing strategy
 * notes and completion reports he had never seen.
 *
 * The identity is not something a harness has to be configured with, because it
 * already DECLARES it: `get_agent_queue { agent: "claude" }` is a claim to be
 * the Claude harness, and the response carries `agent.id`. Polling is the first
 * thing every loop does, so the common case needs no setup at all.
 *
 * In its own file because mcp/mcp-server-oauth.ts sits on the oversized-files
 * ratchet, and because "which identity signs this write" is worth reading on its
 * own rather than as three fields on a 700-line server.
 */

/** The `agent` block of an /api/v1/agent-queue response, as far as this cares. */
interface QueueAgentBlock {
  agent?: { id?: string | null } | null
}

export class McpAgentIdentity {
  private declared: string | null = null
  private readonly configured: string | null

  /**
   * @param configured `ASTRID_AGENT_ID` — the agent user id to sign as when the
   * harness comments before it ever polls. A fallback, not the source of truth.
   */
  constructor(configured: string | null = process.env.ASTRID_AGENT_ID || null) {
    this.configured = configured?.trim() || null
  }

  /**
   * Learn the identity from a queue response.
   *
   * `buildAgentQueue` answers `id: null` for an agent nobody has assigned work to
   * yet — the User row is created on first assignment. Forwarding that null would
   * make the API reject the comment outright ("Invalid aiAgentId"), which is a
   * worse outcome than the wrong name, so an unresolved identity is not recorded
   * and the previous one stands.
   */
  observe(queueResponse: unknown): void {
    const id = (queueResponse as QueueAgentBlock | null)?.agent?.id
    if (typeof id === 'string' && id.length > 0) {
      this.declared = id
    }
  }

  /**
   * The author id to sign a write with, or null to sign as the authenticated
   * caller.
   *
   * The DECLARED identity wins over the configured one. A stale `ASTRID_AGENT_ID`
   * left in a shared config would otherwise sign Copilot's comments as Claude,
   * and the harness that just polled is the one telling the truth about itself.
   * Null is the honest answer for a person driving this server from a desktop
   * client: their own comments should carry their own name.
   */
  authorId(): string | null {
    return this.declared || this.configured
  }
}
