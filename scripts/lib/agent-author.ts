/**
 * Moved to `lib/agent-author.ts` (AWTD-1311).
 *
 * The MCP server needs the same precedence rule — env var, then a lookup by the
 * agent's identity address, then null — and `mcp/` cannot import from
 * `scripts/`: nothing in `app/`, `lib/` or `mcp/` does, and the hosted `/mcp`
 * endpoint ships none of it. Growing a second copy in `mcp/` is how
 * `CLAUDE_AGENT_ID` came to be honoured for one mailbox in one place and all of
 * them in another, so the rule moved down a layer instead.
 *
 * This file stays as a re-export because a dozen scripts import it by this path
 * and renaming them all in the same change would bury the fix.
 */

export {
  agentSignature,
  agentMailboxFrom,
  positionalArgs,
  agentIdEnvVar,
  agentAuthorIdFromEnv,
  resolveAgentAuthorId,
  type AgentAuthorOptions,
} from '@/lib/agent-author'
