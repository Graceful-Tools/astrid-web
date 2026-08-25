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
 * OpenClaw workers are named `<name>.oc@<domain>` — a per-user agent registered
 * through the OpenClaw channel rather than one of the built-ins.
 */
export function isOpenClawAgentEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return openClawEmailPattern().test(email)
}

/** Fresh RegExp per call — a shared /g instance would carry lastIndex between callers. */
export function openClawEmailPattern(): RegExp {
  return new RegExp(`^[a-z0-9._-]+\\.oc@${escapeRegExp(BRAND.agentEmailDomain)}$`, 'i')
}

/** Build an OpenClaw worker identity, e.g. openClawAgentEmail('buddy') -> buddy.oc@astrid.cc */
export function openClawAgentEmail(name: string): string {
  return `${name}.oc@${BRAND.agentEmailDomain}`
}

/**
 * Suffix for matching OpenClaw workers in a database query, e.g. `.oc@astrid.cc`.
 *
 * Prisma's `endsWith` takes a plain string, so query sites cannot use the RegExp above.
 * Looser than `isOpenClawAgentEmail` — it does not constrain the local part — which is
 * fine for narrowing a query that is then filtered in application code.
 */
export function openClawEmailSuffix(): string {
  return `.oc@${BRAND.agentEmailDomain}`
}

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
 * `claude@astrid.cc` -> `claude`. OpenClaw workers (`buddy.oc@astrid.cc`) answer
 * `openclaw`, because every one of them routes through the same channel plugin —
 * callers that need the worker's own name already have the address.
 *
 * Exists so the ~5 sites that need "which built-in agent is this?" stop slicing at
 * the `@` themselves; a hand-rolled split gets the OpenClaw case wrong every time.
 */
export function agentMailboxFromEmail(email: string | null | undefined): string | null {
  if (!isBrandAgentEmail(email)) return null
  if (isOpenClawAgentEmail(email)) return AGENT_MAILBOXES.openclaw
  return email.slice(0, email.lastIndexOf('@')).toLowerCase()
}
