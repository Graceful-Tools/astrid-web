/**
 * Which agent identity a connecting MCP client may author work as.
 *
 * The consent screen used to offer exactly one extra button — "Approve Access as
 * copilot@astrid.cc" — no matter which harness was connecting, because the Copilot
 * consent work (832608e) was the only caller at the time and hardcoded its mailbox
 * end to end. Logging in from Claude Code therefore offered Copilot's identity, and
 * everything that login went on to write was attributed to the wrong agent.
 *
 * The mailbox now comes from the client's own registered `client_name`: Claude Code
 * gets `claude@`, the Codex CLI `codex@`, Gemini CLI `gemini@`, GitHub Copilot
 * `copilot@`. Name matching is shared with the webhook agent-type resolver rather
 * than re-listed here.
 *
 * Resolution is server-side both when rendering the page and when handling the form
 * post: the browser submits only "approve as the agent", never *which* agent, so a
 * client cannot be talked into minting an identity other than the one the consent
 * screen displayed.
 */

import { getAgentConfig } from '@/lib/ai/agent-config'
import { agentEmail, isLocalHarnessAgentEmail } from '@/lib/brand/agent-emails'
import { getAgentType } from '@/lib/webhooks/agent-type'

/**
 * The coding harnesses that may authenticate as themselves.
 *
 * A strict subset of the known agent types: `astrid` is the product's own assistant,
 * `openai` and `openclaw` are server-side identities with no interactive CLI that
 * completes an OAuth consent, and OpenClaw workers are per-user addresses anyway.
 */
export const CONSENT_AGENT_MAILBOXES = ['claude', 'codex', 'copilot', 'gemini'] as const

export type ConsentAgentMailbox = (typeof CONSENT_AGENT_MAILBOXES)[number]

export function isConsentAgentMailbox(value: string | null | undefined): value is ConsentAgentMailbox {
  return !!value && (CONSENT_AGENT_MAILBOXES as readonly string[]).includes(value)
}

/**
 * Does this deployment have a usable User row (or the means to create one) for the
 * mailbox? Routed agents come from AI_AGENT_CONFIG, which BRAND_ENABLED_AGENTS can
 * narrow; `codex@` is deliberately outside that registry — it is a polling-only local
 * harness — so it is checked separately.
 */
export function isConsentAgentAvailable(mailbox: string): boolean {
  const email = agentEmail(mailbox)
  return Boolean(getAgentConfig(email)) || isLocalHarnessAgentEmail(email)
}

/** The subset of an OAuth client this resolver needs. */
export interface ConsentClient {
  name: string
  tokenEndpointAuthMethod: string
  owner: { id: string } | null
}

/**
 * The agent identity this client may author as, or null when it may not.
 *
 * Restricted to dynamically registered public clients, as it was before: an owned or
 * confidential client is somebody's integration, not a coding harness, and must never
 * be able to write under an agent identity.
 */
export function resolveConsentAgentMailbox(client: ConsentClient): ConsentAgentMailbox | null {
  if (client.tokenEndpointAuthMethod !== 'none' || client.owner) return null

  const mailbox = getAgentType(undefined, client.name)
  if (!isConsentAgentMailbox(mailbox)) return null

  return isConsentAgentAvailable(mailbox) ? mailbox : null
}

/**
 * Normalize a mailbox persisted on an authorization code or token.
 *
 * Rows predate this module and are written by an older deployment during a rollout,
 * so a stored value is re-checked rather than trusted. Returns undefined for null
 * (no agent consent) — callers must treat a non-null value that fails to normalize
 * as a hard failure, not as "no agent".
 */
export function normalizeStoredAgentMailbox(value: string | null | undefined): ConsentAgentMailbox | undefined {
  if (!value) return undefined
  return isConsentAgentMailbox(value) && isConsentAgentAvailable(value) ? value : undefined
}
