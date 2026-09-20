/**
 * Who the OAuth scripts are writing AS (AWTD-970).
 *
 * The scripts in this repo authenticate with a client-credentials pair that Jon
 * owns, so `auth.userId` on the server resolves to Jon. Every comment posted
 * without an `aiAgentId` therefore arrives on the board with his name and face —
 * including every `/fixall` completion report and every sweep notice the loop
 * has ever written. AWTD-878 fixed this for the MCP server
 * (`mcp/agent-identity.ts`); this is the same rule for the script path.
 *
 * It is not cosmetic. `fanOutComment` in lib/notifications.ts notifies the
 * assignee, creator and participants and removes the ACTOR — so when the actor
 * is recorded as Jon, the suppression protects the wrong person and he is not
 * notified of things said to him. The attention inbox (AWTD-963) has the same
 * problem from the other end: it asks "is the newest comment from a human?" and
 * gets the wrong answer for everything the loop itself wrote.
 *
 * WHY THIS IS PER-MAILBOX rather than "the Claude agent id". Three scripts each
 * read `CLAUDE_AGENT_ID` directly, which is correct only because they are only
 * ever run by the Claude loop. `scripts/ready-tasks.ts` is not: it takes
 * `--harness`, and Copilot runs it on the same machine, whose `.env.local` sets
 * `CLAUDE_AGENT_ID`. Signing Copilot's sweep as Claude is the exact failure
 * mcp/agent-identity.ts warns about for a stale `ASTRID_AGENT_ID`.
 *
 * WHY NULL IS AN ANSWER. An id the API cannot resolve is a 400 ("Invalid
 * aiAgentId"), so an unresolved identity must send no field at all rather than a
 * guessed one. Callers spread it — `...(authorId ? { aiAgentId: authorId } : {})`
 * — so absent means "sign as the caller", which is the honest fallback for a
 * person driving these scripts by hand.
 */

import { agentEmail } from '@/lib/brand/agent-emails'

/** The env var any harness may set: `ASTRID_AGENT_ID_CLAUDE`, `…_COPILOT`, … */
export function agentIdEnvVar(mailbox: string): string {
  return `ASTRID_AGENT_ID_${mailbox.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

export interface AgentAuthorOptions {
  /** Agent mailbox to sign as — `claude`, `copilot`, `codex`, … */
  mailbox: string
  /** OAuth access token, needed only for the lookup fallback. */
  accessToken?: string
  /** Defaults to `process.env`; injected so the rule is testable. */
  env?: Record<string, string | undefined>
  /** Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  apiBase?: string
  /** Where to say that the identity could not be resolved. */
  warn?: (message: string) => void
}

const DEFAULT_API_BASE = 'https://astrid.cc'

/**
 * The configured agent id for this mailbox, without touching the network.
 *
 * `CLAUDE_AGENT_ID` is honoured for the claude mailbox ONLY. It predates this
 * helper and is what is actually in `.env.local`, so dropping it would silently
 * send every Claude script back to the lookup path — but widening it to other
 * mailboxes is the cross-signing bug above.
 */
export function agentAuthorIdFromEnv(
  mailbox: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = env[agentIdEnvVar(mailbox)]?.trim()
  if (explicit) return explicit

  if (mailbox === 'claude') {
    const legacy = env.CLAUDE_AGENT_ID?.trim()
    if (legacy) return legacy
  }

  return null
}

/**
 * The author id to sign a write with, or null to sign as the authenticated
 * caller.
 *
 * Env first — it is free and it is how every scheduled run is configured. The
 * lookup exists so a harness nobody has configured still writes as itself: the
 * agent's User row is findable through any task assigned to it, which for a
 * polling harness is guaranteed to exist by the time it is commenting.
 */
export async function resolveAgentAuthorId(
  options: AgentAuthorOptions,
): Promise<string | null> {
  const {
    mailbox,
    accessToken,
    env = process.env,
    fetchImpl = fetch,
    apiBase = DEFAULT_API_BASE,
    warn = console.warn,
  } = options

  const configured = agentAuthorIdFromEnv(mailbox, env)
  if (configured) return configured

  // Derived from the brand, so a fork's agents are at ITS domain. The legacy
  // `CLAUDE_AGENT_EMAIL` override is kept for the claude mailbox because it is
  // a registered tooling variable (lib/env.ts) that scripts/add-task-comment.ts
  // honoured before this helper existed.
  const email =
    (mailbox === 'claude' ? env.CLAUDE_AGENT_EMAIL?.trim() : null) || agentEmail(mailbox)

  if (!accessToken) {
    warn(`⚠️ No ${agentIdEnvVar(mailbox)} and no access token — writing as the OAuth client owner.`)
    return null
  }

  try {
    const response = await fetchImpl(
      `${apiBase}/api/v1/tasks?assigneeEmail=${encodeURIComponent(email)}&limit=1`,
      { headers: { 'X-OAuth-Token': accessToken, 'Content-Type': 'application/json' } },
    )

    if (response.ok) {
      const data = await response.json()
      const tasks = data.tasks ?? [data.task].filter(Boolean)
      const id = Array.isArray(tasks) ? tasks[0]?.assignee?.id : undefined
      if (typeof id === 'string' && id.length > 0) return id
    }
  } catch (error) {
    warn(`⚠️ Could not look up ${email}: ${error instanceof Error ? error.message : error}`)
    return null
  }

  warn(`⚠️ Could not resolve the agent user for ${email} — set ${agentIdEnvVar(mailbox)} in .env.local.`)
  return null
}
