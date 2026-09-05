/**
 * AI agent email identities, derived from the brand.
 *
 * Agent identities are `<mailbox>@<BRAND.agentEmailDomain>` — `claude@astrid.cc` for
 * Astrid itself, `claude@acme.example` for a fork. This module is the only place that
 * knows how those addresses are shaped, so the ~10 sites that used to hand-roll
 * `email.endsWith('@astrid.cc')` or `/\.oc@astrid\.cc$/i` can share one implementation.
 *
 * Note the domain is matched, never assumed: a user really can have a personal address
 * at the brand's domain, so `isBrandAgentEmail` is about the shape of an agent identity,
 * not about who owns the domain. Callers that need "is this row an AI agent?" should
 * still prefer the `User.isAIAgent` database flag — see lib/ai-agent-registry.ts.
 */

import { BRAND } from './config'

/** Mailboxes for the built-in agents. */
export const AGENT_MAILBOXES = {
  astrid: 'astrid',
  claude: 'claude',
  openai: 'openai',
  gemini: 'gemini',
  copilot: 'copilot',
  codex: 'codex',
  openclaw: 'openclaw',
} as const

export type AgentMailbox = keyof typeof AGENT_MAILBOXES

/**
 * Agent users owned by a local polling harness rather than a server AI provider.
 *
 * Keep these outside AI_AGENT_CONFIG: treating Codex as OpenAI would let the cloud
 * OpenAI workflow consume tasks assigned to the local Codex CLI.
 */
export const LOCAL_HARNESS_AGENT_MAILBOXES = [AGENT_MAILBOXES.codex] as const

/** Does this address belong to a polling-only local harness identity? */
export function isLocalHarnessAgentEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.toLowerCase()
  return LOCAL_HARNESS_AGENT_MAILBOXES.some(
    (mailbox) => normalized === agentEmail(mailbox).toLowerCase(),
  )
}

/** Build an agent identity address, e.g. agentEmail('claude') -> claude@astrid.cc */
export function agentEmail(mailbox: string): string {
  return `${mailbox}@${BRAND.agentEmailDomain}`
}

/** Escape a value for safe embedding in a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Does this address live at the agent-identity domain?
 *
 * Replaces the inlined `email?.endsWith('@astrid.cc')` checks. Case-insensitive,
 * because email domains are. Declared as a type guard so call sites keep the
 * non-null narrowing they had from `email?.endsWith(...)`.
 */
export function isBrandAgentEmail(email: string | null | undefined): email is string {
  if (!email) return false
  return email.toLowerCase().endsWith(`@${BRAND.agentEmailDomain.toLowerCase()}`)
}

/**
 * Custom Agents retain the original `<name>.oc@<domain>` identity format during
 * the compatibility phase. The suffix is an internal routing key, not product copy.
 */
export function isCustomAgentEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return customAgentEmailPattern().test(email)
}

/** Fresh RegExp per call — a shared /g instance would carry lastIndex between callers. */
export function customAgentEmailPattern(): RegExp {
  return new RegExp(`^[a-z0-9._-]+\\.oc@${escapeRegExp(BRAND.agentEmailDomain)}$`, 'i')
}

/** Build a Custom Agent identity while `.oc@` remains the issued compatibility suffix. */
export function customAgentEmail(name: string): string {
  return `${name}.oc@${BRAND.agentEmailDomain}`
}

/**
 * Suffix for matching Custom Agents in a database query, e.g. `.oc@astrid.cc`.
 *
 * Prisma's `endsWith` takes a plain string, so query sites cannot use the RegExp above.
 * Looser than `isOpenClawAgentEmail` — it does not constrain the local part — which is
 * fine for narrowing a query that is then filtered in application code.
 */
export function customAgentEmailSuffix(): string {
  return `.oc@${BRAND.agentEmailDomain}`
}

/** @deprecated Compatibility name; use isCustomAgentEmail. */
export const isOpenClawAgentEmail = isCustomAgentEmail
/** @deprecated Compatibility name; use customAgentEmailPattern. */
export const openClawEmailPattern = customAgentEmailPattern
/** @deprecated Compatibility name; use customAgentEmail. */
export const openClawAgentEmail = customAgentEmail
/** @deprecated Compatibility name; use customAgentEmailSuffix. */
export const openClawEmailSuffix = customAgentEmailSuffix

/**
 * Placeholder used in webhook payloads when a task's creator has no email on record.
 *
 * A sentinel, not a real mailbox — nothing delivers here and no User row owns it. It
 * follows the brand domain only so payloads stay internally consistent for a fork.
 */
export const UNKNOWN_CREATOR_EMAIL = `unknown@${BRAND.agentEmailDomain}`

/**
 * The mailbox part of an agent identity, or null when the address is not one.
 *
 * `claude@astrid.cc` -> `claude`. Custom Agents (`buddy.oc@astrid.cc`) answer
 * `openclaw`, because that remains their internal routing mailbox —
 * callers that need the worker's own name already have the address.
 *
 * Exists so the ~5 sites that need "which built-in agent is this?" stop slicing at
 * the `@` themselves; a hand-rolled split gets the OpenClaw case wrong every time.
 */
export function agentMailboxFromEmail(email: string | null | undefined): string | null {
  if (!isBrandAgentEmail(email)) return null
  if (isCustomAgentEmail(email)) return AGENT_MAILBOXES.openclaw
  return email.slice(0, email.lastIndexOf('@')).toLowerCase()
}
