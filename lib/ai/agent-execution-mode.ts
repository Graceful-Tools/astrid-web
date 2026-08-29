/**
 * Who actually runs an agent: this server, or the user's own harness.
 *
 * Astrid has always had exactly one answer — the server calls the provider API on
 * the user's key the moment a task is assigned or commented on. That answer costs
 * the user metered API tokens for work their Claude Code / Codex / Copilot
 * subscription already covers, and it fails in a way nothing on the board explains:
 * when the key runs dry every trigger returns a 400, the workflow retries, and the
 * task collects a hundred identical failures instead of getting done.
 *
 * `polling` mode is the other answer. Astrid does not call any provider. The task
 * simply sits in the agent's queue (Ready + assigned to that agent) and the user's
 * own harness picks it up on its own loop — `/loop 30m /fixall` in Claude Code, a
 * cron'd `codex exec`, a scheduled GitHub Actions job. Same agent in the same list,
 * same comments, same assignment handshake. Only the runtime moves.
 *
 * The mode is per user AND per agent, because both halves vary: one person runs
 * Claude locally and lets Gemini answer from the server, and the same agent
 * identity is shared by users who have a harness and users who only have a phone.
 *
 * Stored in `User.mcpSettings.agentModes`, keyed by MAILBOX (`claude`, `codex`,
 * `copilot`, …) rather than by provider service, because `codex` has no service
 * and the user is choosing per agent-in-the-list, not per API vendor.
 */

import { prisma } from '@/lib/prisma'
import {
  AGENT_MAILBOXES,
  LOCAL_HARNESS_AGENT_MAILBOXES,
  agentMailboxFromEmail,
} from '@/lib/brand/agent-emails'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai.agent-execution-mode')

/**
 * `api`     — this server calls the provider on the user's key.
 * `polling` — the user's harness reads the queue; the server dispatches nothing.
 * `webhook` — the user's self-hosted server (astrid-sdk) is pushed the work.
 *             At dispatch time it behaves like `api` — the notifiers already
 *             try the user's webhook first. The mode exists so the UI can show
 *             webhook setup for exactly the agents the user runs that way.
 * `off`     — the agent is not in use: hidden from pickers, and the server
 *             dispatches nothing for it. Unlike `polling`, nothing is coming
 *             to collect the work either — assignment to an off agent is
 *             possible only for tasks assigned before it was turned off.
 *
 * Dispatch suppression is `polling` OR `off`; `api` and `webhook` dispatch.
 */
export const AGENT_EXECUTION_MODES = ['api', 'polling', 'webhook', 'off'] as const
export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number]

export function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
  return typeof value === 'string' && (AGENT_EXECUTION_MODES as readonly string[]).includes(value)
}

/**
 * Agents with no server-side executor at all. Mode is not a choice for these —
 * `codex@` exists precisely because the Codex CLI runs on the user's machine, and
 * routing its tasks through the OpenAI workflow would have the cloud agent eat
 * work the local harness was handed.
 */
const FORCED_POLLING_MAILBOXES: readonly string[] = LOCAL_HARNESS_AGENT_MAILBOXES

/**
 * The coding agents — the ones whose work a local harness can actually do, and
 * therefore the ones that default to polling.
 *
 * The assistant identity (`astrid@`) is deliberately absent: it answers in chat,
 * on a phone, for people who have no harness and never will. Defaulting *that* to
 * polling would produce an assistant that silently never replies.
 */
const CODING_AGENT_MAILBOXES: readonly string[] = [
  AGENT_MAILBOXES.claude,
  AGENT_MAILBOXES.codex,
  AGENT_MAILBOXES.copilot,
  AGENT_MAILBOXES.openai,
  AGENT_MAILBOXES.gemini,
]

/** Which provider key backs a mailbox, for the "they already chose API" default. */
const MAILBOX_CREDENTIAL_KEYS: Record<string, string> = {
  [AGENT_MAILBOXES.claude]: 'claude',
  [AGENT_MAILBOXES.openai]: 'openai',
  [AGENT_MAILBOXES.gemini]: 'gemini',
  [AGENT_MAILBOXES.copilot]: 'copilot',
}

export interface AgentExecutionModeInput {
  /** Agent mailbox (`claude`), or null for an address that is not an agent. */
  mailbox: string | null
  /** `User.mcpSettings.agentModes` for the user who owns the run. */
  storedModes?: Record<string, unknown> | null
  /** Does that user have a provider key saved for this agent's service? */
  hasStoredCredential?: boolean
}

/**
 * Resolve the mode without touching the database, so the rules are testable and
 * the API route, the dispatch gate and the settings UI cannot drift apart.
 *
 * Order matters:
 *  1. No server executor exists  -> polling, and no setting can override it.
 *  2. The user said              -> what the user said.
 *  3. A coding agent with a key  -> api. Saving a key IS choosing API mode, and a
 *     working setup must not change under someone because a default moved.
 *  4. A coding agent without one -> polling. Nothing is burned, nothing 400s, and
 *     the task waits visibly in the queue instead of failing invisibly.
 *  5. Anything else              -> api.
 */
export function resolveAgentExecutionMode({
  mailbox,
  storedModes,
  hasStoredCredential = false,
}: AgentExecutionModeInput): AgentExecutionMode {
  if (!mailbox) return 'api'

  if (FORCED_POLLING_MAILBOXES.includes(mailbox)) return 'polling'

  const stored = storedModes?.[mailbox]
  if (isAgentExecutionMode(stored)) return stored

  if (CODING_AGENT_MAILBOXES.includes(mailbox)) {
    return hasStoredCredential ? 'api' : 'polling'
  }

  return 'api'
}

/** Is this mailbox stuck in polling because no server-side executor exists? */
export function isModeLockedToPolling(mailbox: string | null): boolean {
  return !!mailbox && FORCED_POLLING_MAILBOXES.includes(mailbox)
}

/** Every agent a user can put in polling mode, in the order the settings UI lists them. */
export function pollableMailboxes(): readonly string[] {
  return CODING_AGENT_MAILBOXES
}

interface StoredAgentSettings {
  modes: Record<string, unknown>
  credentialedServices: Set<string>
}

async function readAgentSettings(userId: string | null | undefined): Promise<StoredAgentSettings> {
  const empty: StoredAgentSettings = { modes: {}, credentialedServices: new Set() }
  if (!userId) return empty

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true },
    })
    if (!user) return empty

    const settings = parseUserAIConfig(user.mcpSettings, MCPSettingsSchema, 'agent-execution-mode')
    const apiKeys = settings.apiKeys ?? {}
    const credentialedServices = new Set(
      Object.entries(apiKeys)
        .filter(([, info]) => !!info && typeof info === 'object' && 'encrypted' in info)
        .map(([service]) => service)
    )
    return { modes: (settings.agentModes ?? {}) as Record<string, unknown>, credentialedServices }
  } catch (err) {
    // A settings read that fails must not decide the mode by accident. Falling
    // through to the defaults keeps a database blip from silently firing paid API
    // calls for someone who had turned them off.
    log.warn({ err, userId }, 'could not read agent modes; using defaults')
    return empty
  }
}

/** The mode a given user's agent runs in, resolved against their saved settings. */
export async function getAgentExecutionMode(
  userId: string | null | undefined,
  agentEmailAddress: string | null | undefined
): Promise<AgentExecutionMode> {
  const mailbox = agentMailboxFromEmail(agentEmailAddress)
  if (!mailbox) return 'api'
  if (isModeLockedToPolling(mailbox)) return 'polling'

  const { modes, credentialedServices } = await readAgentSettings(userId)
  const credentialKey = MAILBOX_CREDENTIAL_KEYS[mailbox]
  return resolveAgentExecutionMode({
    mailbox,
    storedModes: modes,
    hasStoredCredential: !!credentialKey && credentialedServices.has(credentialKey),
  })
}

/**
 * Should the server keep its hands off this agent's task?
 *
 * The one question every dispatch site asks. `userId` is whoever owns the run —
 * the list's `aiAgentConfiguredBy`, else the task creator, else the list owner —
 * and an unknown owner still gets the safe answer for `codex@`.
 */
export async function isPollingOnlyAgent(
  agentEmailAddress: string | null | undefined,
  userId: string | null | undefined
): Promise<boolean> {
  const mode = await getAgentExecutionMode(userId, agentEmailAddress)
  // `off` suppresses dispatch for the same reason polling does — the server
  // must not run this agent. The difference (nothing collects the queue
  // either) matters to pickers, not to dispatch.
  return mode === 'polling' || mode === 'off'
}

/**
 * Should this agent appear in pickers and the available-agents lists?
 *
 * Offered = what can WORK for this user, not what the server can bill:
 *  - `polling` and `webhook` need no provider key — the user's own harness or
 *    server is the runtime, so they are offered as configured.
 *  - `api` is offered only with a valid key; keyless api-mode would list an
 *    agent whose every dispatch 400s.
 *  - `off` means exactly that — hidden even when a key is still saved, because
 *    the key surviving is what makes turning it back on one click.
 * (Task 9dbe0b17.)
 */
export function isAgentOffered(mode: AgentExecutionMode, hasKey: boolean): boolean {
  if (mode === 'off') return false
  if (mode === 'polling' || mode === 'webhook') return true
  return hasKey
}

/** Every pollable agent's mode for one user, for the settings screen. */
export async function getAgentExecutionModes(
  userId: string
): Promise<Record<string, AgentExecutionMode>> {
  const { modes, credentialedServices } = await readAgentSettings(userId)
  const resolved: Record<string, AgentExecutionMode> = {}

  for (const mailbox of CODING_AGENT_MAILBOXES) {
    const credentialKey = MAILBOX_CREDENTIAL_KEYS[mailbox]
    resolved[mailbox] = resolveAgentExecutionMode({
      mailbox,
      storedModes: modes,
      hasStoredCredential: !!credentialKey && credentialedServices.has(credentialKey),
    })
  }

  return resolved
}

/**
 * Persist one agent's mode.
 *
 * Read-modify-write on the same blob the API keys live in, so a save here cannot
 * drop a credential. Rejects a mailbox that has no choice to make rather than
 * writing a setting the resolver will ignore — a stored `api` for `codex@` would
 * read, forever after, as a preference someone set and Astrid disobeyed.
 */
export async function setAgentExecutionMode(
  userId: string,
  mailbox: string,
  mode: AgentExecutionMode
): Promise<Record<string, AgentExecutionMode>> {
  if (isModeLockedToPolling(mailbox)) {
    throw new Error(`${mailbox} runs in your own harness; it has no API mode.`)
  }
  if (!CODING_AGENT_MAILBOXES.includes(mailbox)) {
    throw new Error(`Unknown agent "${mailbox}".`)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpSettings: true },
  })
  const settings = parseUserAIConfig(user?.mcpSettings, MCPSettingsSchema, 'agent-execution-mode')
  const agentModes = { ...(settings.agentModes ?? {}), [mailbox]: mode }

  await prisma.user.update({
    where: { id: userId },
    data: { mcpSettings: JSON.stringify({ ...settings, agentModes }) },
  })

  return getAgentExecutionModes(userId)
}

export interface AgentRunOwnerCandidates {
  /** The list's configured agent owner, when a list configured one. */
  aiAgentConfiguredBy?: string | null
  /** Who filed the task. */
  creatorId?: string | null
  /** Who owns the list it sits on. */
  listOwnerId?: string | null
}

/**
 * Whose settings govern a server-side agent run.
 *
 * The same order the orchestrator already uses to pick whose API key to spend
 * (`lib/comments/post-comment-side-effects.ts`): the list's configured owner, then
 * the task's creator, then the list owner. Stated once here so the mode check and
 * the billing cannot land on two different people — an agent that runs on Jon's
 * key while reading Ann's mode setting is the worst of both answers.
 */
export function resolveAgentRunOwnerId({
  aiAgentConfiguredBy,
  creatorId,
  listOwnerId,
}: AgentRunOwnerCandidates): string | null {
  return aiAgentConfiguredBy || creatorId || listOwnerId || null
}
