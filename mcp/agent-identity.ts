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
 *
 * ---
 *
 * AWTD-1311 added the second way in, because polling-first was an assumption and
 * not a guarantee. Jon, on AWTD-1305: *"This comment is coming from the current
 * user. This is a bug. It should come from Claude."* Two agent comments there are
 * stored with the client owner as author — a harness commented before it ever
 * polled, `ASTRID_AGENT_ID` is not in `.env.local`, and the write went out
 * unsigned.
 *
 * Config cannot close that. There is no `.mcp.json` here (see
 * mcp/astrid-mcp-launch.js for why credentials are not copied into a per-client
 * config) and `.env.local` is shared by every harness on the machine, which is
 * the cross-signing hazard lib/agent-author.ts is written against. So the
 * declaration travels in the CALL: `agent: "<mailbox>"` on the write itself.
 *
 * THE RULE THAT MAKES IT A FIX RATHER THAN ANOTHER FALLBACK: a write that
 * declares an agent is signed by that agent or it is REFUSED. It never quietly
 * becomes a human write. A silent fall-through to the caller is the original bug
 * wearing a new hat, and it is invisible in the response — the harness is told
 * `success: true`, the board shows the wrong face, and nobody finds out until
 * Jon reads his own strategy notes.
 *
 * Omission is unchanged and deliberate: a write that declares nothing still
 * signs as the caller, because a person driving this server from a desktop
 * client should carry their own name. `agent: "me"` is how they say so on
 * purpose when they would rather be explicit.
 */

// RELATIVE, and to a LEAF. mcp/build-mcp-oauth.js compiles this file with
// `tsc --ignoreConfig`, so `@/` does not exist and every transitive import must
// resolve too. `lib/agent-author.ts` cannot be used here: it reaches
// `lib/brand/agent-emails.ts`, which reaches `@/lib/ai/harness-agents`. The env
// precedence was split into its own importless module for exactly this
// (AWTD-1311), so both sides share one rule instead of keeping two.
import { agentAuthorIdFromEnv } from '../lib/agent-mailbox-env'

/** The `agent` block of an /api/v1/agent-queue response, as far as this cares. */
interface QueueAgentBlock {
  agent?: { id?: string | null; mailbox?: string } | null
}

/**
 * The mailbox a human passes to sign as themselves on purpose.
 *
 * Not a real mailbox — no agent is called "me" — so it cannot collide with one,
 * and it reads correctly at the call site.
 */
export const HUMAN_MAILBOX = 'me'

/** Thrown instead of signing a declared agent write as the authenticated caller. */
export class UnresolvedAgentIdentityError extends Error {
  constructor(public readonly mailbox: string) {
    super(
      `Cannot write as the "${mailbox}" agent: no ${envVarHint(mailbox)} is set and no user was ` +
        `found at that mailbox. Refusing rather than signing this as the OAuth client's owner — ` +
        `that is AWTD-1311. Set ${envVarHint(mailbox)} in .env.local, assign one task to ` +
        `${mailbox} so the agent's user row exists, or pass agent: "${HUMAN_MAILBOX}" to sign as ` +
        `yourself on purpose.`,
    )
    this.name = 'UnresolvedAgentIdentityError'
  }
}

function envVarHint(mailbox: string): string {
  return `ASTRID_AGENT_ID_${mailbox.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
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

  /**
   * The identity fields to merge into a write body — spread it, don't branch.
   *
   * ABSENT rather than null when unknown: the routes branch on the key being
   * present, and an explicit null reads as a caller-chosen author and is
   * rejected. Comments and task updates both need this (AWTD-878, AWTD-974),
   * and writing the ternary twice is how one of them ends up sending null.
   */
  signature(): { aiAgentId?: string } {
    const id = this.authorId()
    return id ? { aiAgentId: id } : {}
  }

  /**
   * The identity fields for a write that may DECLARE its mailbox (AWTD-1311).
   *
   * Precedence, and the reasoning for each step:
   *
   * 1. `agent: "me"` — the caller has said they are a person. Sign as them.
   * 2. A prior poll. The API checked that claim; a per-call argument has not, so
   *    a mailbox typo on one write cannot override an identity the server
   *    already confirmed.
   * 3. The declared mailbox, resolved through the per-mailbox env var — the
   *    same rule lib/agent-author.ts applies for the scripts, shared rather than
   *    restated. Unresolvable is a THROW, never the caller: the scripts can fall
   *    back to a network lookup, but this file must stay importless for the
   *    standalone build, and signing as the wrong person is the worse outcome.
   * 4. No declaration at all: whatever `signature()` already said, which for a
   *    person at a desktop client is "sign as me".
   */
  signatureFor(agent: string | undefined): { aiAgentId?: string } {
    const mailbox = agent?.trim().toLowerCase()
    if (!mailbox) return this.signature()
    if (mailbox === HUMAN_MAILBOX) return {}
    if (this.declared) return { aiAgentId: this.declared }

    const fromEnv = agentAuthorIdFromEnv(mailbox)
    if (fromEnv) return { aiAgentId: fromEnv }

    throw new UnresolvedAgentIdentityError(mailbox)
  }

  async resolveSignatureFor(
    agent: string | undefined,
    client: { makeRequest<T>(path: string): Promise<T> },
  ): Promise<{ aiAgentId?: string }> {
    try {
      return this.signatureFor(agent)
    } catch (error) {
      if (!(error instanceof UnresolvedAgentIdentityError)) throw error
      // Hosted MCP is stateless between calls; learn from the authenticated
      // queue instead of assuming a previous request's poll survived.
      const response = await client.makeRequest<QueueAgentBlock>(
        `/api/v1/agent-queue?agent=${encodeURIComponent(error.mailbox)}`,
      )
      if (response.agent?.mailbox !== error.mailbox || !response.agent.id) throw error
      this.observe(response)
      return this.signatureFor(agent)
    }
  }
}
