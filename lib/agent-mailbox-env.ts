/**
 * Which agent id a mailbox is configured as — and NOTHING else (AWTD-1311).
 *
 * A leaf on purpose: no imports, at all. `mcp/agent-identity.ts` needs this
 * rule, and the standalone stdio server is built by
 * `mcp/build-mcp-oauth.js` with `tsc --ignoreConfig`, so the `@/` alias does
 * not exist and every transitive import must resolve relatively. The fuller
 * `lib/agent-author.ts` cannot be imported there because it reaches
 * `lib/brand/agent-emails.ts`, which reaches `@/lib/ai/harness-agents` — a
 * chain that builds fine in Next and not at all in that one-file compile.
 *
 * Splitting the rule out beats copying it. The precedence below is the thing
 * AWTD-970 was filed about, and two copies of it is how `CLAUDE_AGENT_ID` came
 * to be honoured for one mailbox in one place and all of them in another.
 */

/** The env var any harness may set: `ASTRID_AGENT_ID_CLAUDE`, `…_COPILOT`, … */
export function agentIdEnvVar(mailbox: string): string {
  return `ASTRID_AGENT_ID_${mailbox.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * The configured agent id for this mailbox, without touching the network.
 *
 * `CLAUDE_AGENT_ID` is honoured for the claude mailbox ONLY. It predates the
 * per-mailbox vars and is what is actually in `.env.local`, so dropping it
 * would silently send every Claude script to the lookup path — but widening it
 * to other mailboxes signs a Copilot run as Claude on every machine that runs
 * the Claude loop, which is the bug AWTD-1311 found in `set-task-status.ts`.
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
