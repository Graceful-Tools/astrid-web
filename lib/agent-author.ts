/**
 * Who an agent-driven write is AS (AWTD-970, moved down a layer by AWTD-1311).
 *
 * It lived in `scripts/lib/` while only the scripts needed it. The MCP server
 * needs the identical rule — AWTD-1311 was two agent comments signed with the
 * account holder's name because the MCP path had no way to resolve a mailbox
 * before its first poll — and `mcp/` cannot import from `scripts/`: nothing in
 * `app/`, `lib/` or `mcp/` does, and the hosted `/mcp` endpoint ships none of
 * it. `scripts/lib/agent-author.ts` re-exports this so the existing callers
 * keep their import path.
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
import { brandOrigin } from '@/lib/brand/config'
// The env precedence is a leaf module so mcp/agent-identity.ts can share it —
// the standalone stdio build cannot follow this file's own imports (AWTD-1311).
import { agentIdEnvVar, agentAuthorIdFromEnv } from '@/lib/agent-mailbox-env'
export { agentIdEnvVar, agentAuthorIdFromEnv }

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

const DEFAULT_API_BASE = brandOrigin()

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
      const assignee = Array.isArray(tasks) ? tasks[0]?.assignee : undefined
      // Trust the answer only if it IS the agent asked for (AWTD-1020). A route
      // that ignores the filter returns an arbitrary task; its assignee is a
      // person (a 400) or another harness (a comment signed as the wrong agent).
      if (
        typeof assignee?.id === 'string' &&
        assignee.id.length > 0 &&
        assignee.isAIAgent === true &&
        String(assignee.email ?? '').toLowerCase() === email.toLowerCase()
      ) {
        return assignee.id
      }
    }
  } catch (error) {
    warn(`⚠️ Could not look up ${email}: ${error instanceof Error ? error.message : error}`)
    return null
  }

  warn(`⚠️ Could not resolve the agent user for ${email} — set ${agentIdEnvVar(mailbox)} in .env.local.`)
  return null
}

/**
 * The mailbox a script was told to write as (AWTD-1311).
 *
 * `--agent <mailbox>` is the form the runner already uses —
 * `scripts/fixall-loop.sh` passes `--agent claude` to `release-stuck-doing.ts`
 * and `agent-queue-status.ts` — so every other board-writing script takes it the
 * same way rather than inventing a flag each.
 *
 * `ASTRID_AGENT_MAILBOX` is the fallback for a script the runner invokes without
 * arguments. It names a MAILBOX, not an id, which is the difference that matters:
 * a stale id signs as the wrong agent, while a stale mailbox resolves to that
 * mailbox's own agent or to nothing.
 *
 * NULL IS THE ANSWER when neither is set, and callers must treat it as "sign as
 * whoever is authenticated" rather than guessing a default. Defaulting to
 * `claude` here would sign every Copilot run as Claude on any machine that runs
 * the Claude loop, which is the same bug with a different wrong name on it.
 */
export function agentMailboxFrom(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): string | null {
  const flag = argv.indexOf('--agent')
  if (flag !== -1) {
    const value = argv[flag + 1]
    // A following flag is a missing value, not a mailbox — the same reason
    // scripts/lib/fixall-claim-args.ts treats it as fatal (AWTD-922).
    if (!value || value.startsWith('--')) {
      throw new Error('--agent requires a mailbox, e.g. --agent claude')
    }
    return value.trim().toLowerCase() || null
  }

  return env.ASTRID_AGENT_MAILBOX?.trim().toLowerCase() || null
}

/**
 * The `aiAgentId` fields for a board write, or `{}` to sign as the caller.
 *
 * Spread it — `{ ...updates, ...(await agentSignature(token)) }`. Absent rather
 * than null, because `POST /api/v1/tasks/:id/comments` rejects an explicit null
 * as a caller-chosen author.
 */
export async function agentSignature(
  accessToken?: string,
  argv?: string[],
): Promise<{ aiAgentId?: string }> {
  const mailbox = agentMailboxFrom(argv)
  if (!mailbox) {
    console.warn(
      '⚠️ No --agent <mailbox> and no ASTRID_AGENT_MAILBOX — this write will carry the OAuth ' +
        "client owner's name (AWTD-1311).",
    )
    return {}
  }

  const authorId = await resolveAgentAuthorId({ mailbox, accessToken })
  return authorId ? { aiAgentId: authorId } : {}
}

/**
 * The positional arguments, with `--agent <mailbox>` consumed as a PAIR.
 *
 * `argv.filter(a => !a.startsWith('--'))` drops the flag and keeps its value, so
 * `--agent claude <taskId>` yields `["claude", taskId]` and the script reads a
 * mailbox as its first positional. That exact filter broke every local harness
 * claim for a while (AWTD-922, scripts/lib/fixall-claim-args.ts) — one
 * left-to-right pass, not two independent scans of the same array.
 */
export function positionalArgs(argv: string[] = process.argv.slice(2)): string[] {
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') {
      i++ // consume the mailbox with its flag
      continue
    }
    if (argv[i].startsWith('--')) continue
    positional.push(argv[i])
  }
  return positional
}
