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

import { agentAuthorIdFromEnv } from '@/lib/agent-author'
import { agentEmail } from '@/lib/brand/agent-emails'

/** The `agent` block of an /api/v1/agent-queue response, as far as this cares. */
interface QueueAgentBlock {
  agent?: { id?: string | null } | null
}

/**
 * The mailbox a human passes to sign as themselves on purpose.
 *
 * Not a real mailbox — no agent is called "me" — so it cannot collide with one,
 * and it reads correctly at the call site.
 */
export const HUMAN_MAILBOX = 'me'

/** Looks an agent's user id up by its identity address. Injected so this file stays offline. */
export type AgentIdLookup = (mailbox: string) => Promise<string | null>

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
   * 3. The declared mailbox, resolved through env and then a lookup — the same
   *    precedence lib/agent-author.ts applies for the scripts, imported rather
   *    than restated. Unresolvable is a THROW, never the caller.
   * 4. No declaration at all: whatever `signature()` already said, which for a
   *    person at a desktop client is "sign as me".
   */
  async signatureFor(
    agent: string | undefined,
    lookup: AgentIdLookup,
  ): Promise<{ aiAgentId?: string }> {
    const mailbox = agent?.trim().toLowerCase()
    if (!mailbox) return this.signature()
    if (mailbox === HUMAN_MAILBOX) return {}
    if (this.declared) return { aiAgentId: this.declared }

    const fromEnv = agentAuthorIdFromEnv(mailbox)
    if (fromEnv) return { aiAgentId: fromEnv }

    const found = await lookup(mailbox)
    if (found) return { aiAgentId: found }

    throw new UnresolvedAgentIdentityError(mailbox)
  }
}

/** What `agentIdLookupVia` needs of an API client — the OAuth one satisfies it. */
interface RequestingClient {
  makeRequest<T = unknown>(endpoint: string, options?: RequestInit): Promise<T>
}

/**
 * Look an agent's user id up by its identity address, through an API client.
 *
 * Here rather than on the server because mcp/mcp-server-oauth.ts sits on the
 * oversized-files ratchet, and because this is the same "which identity signs
 * this write" question the rest of the file answers.
 *
 * It goes through the CLIENT rather than a raw fetch so it inherits the base URL
 * and the credential the server is already authenticated with — passing a token
 * around is how the scripts ended up with three ways to ask one question.
 *
 * AWTD-1020 is why the answer is checked rather than trusted: a route that
 * ignores `assigneeEmail` returns an arbitrary task, whose assignee is a person
 * (a 400 on the write) or another harness (a comment signed as the wrong agent).
 */
export function agentIdLookupVia(client: RequestingClient): AgentIdLookup {
  return async mailbox => {
    const email = agentEmail(mailbox)
    try {
      const data = await client.makeRequest<{
        tasks?: Array<{ assignee?: { id?: string; email?: string; isAIAgent?: boolean } }>
      }>(`/api/v1/tasks?assigneeEmail=${encodeURIComponent(email)}&limit=1`)
      const assignee = data?.tasks?.[0]?.assignee
      if (
        typeof assignee?.id === 'string' &&
        assignee.id.length > 0 &&
        assignee.isAIAgent === true &&
        String(assignee.email ?? '').toLowerCase() === email.toLowerCase()
      ) {
        return assignee.id
      }
    } catch {
      // Swallowed on purpose: the caller turns null into
      // UnresolvedAgentIdentityError, which says what to do about it. A raw
      // network error here would read as "the comment failed", not "I do not
      // know who you are".
    }
    return null
  }
}
