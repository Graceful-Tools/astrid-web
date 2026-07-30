/**
 * Centralized AI Agent Configuration
 *
 * Single source of truth for all AI agent routing.
 * When a task is assigned to an agent email, this config determines:
 * - Which AI service to use (Claude, OpenAI, Gemini)
 * - Which model to use
 * - What context file to load (all cloud agents use ASTRID.md)
 *
 * Task 97208a72: which agents a deployment supports, and the domain their identities
 * live at, are configuration rather than source. Agent emails come from
 * lib/brand/agent-emails.ts; the enabled set comes from BRAND_ENABLED_AGENTS.
 */

import { agentEmail, openClawEmailPattern } from '@/lib/brand/agent-emails'
import { BRAND } from '@/lib/brand/config'

export type AIService = 'claude' | 'openai' | 'gemini' | 'copilot' | 'openclaw'

/** On-device model sentinel IDs — handled client-side, never processed by the server */
export const ON_DEVICE_MODEL_IDS = ['apple-foundation-model'] as const
export type OnDeviceModelId = typeof ON_DEVICE_MODEL_IDS[number]

export interface AIAgentConfig {
  /** The AI service provider */
  service: AIService
  /** Default model to use */
  model: string
  /** Display name for UI */
  displayName: string
  /** Agent type stored in database */
  agentType: string
  /** Context file to load from repository (all agents use ASTRID.md) */
  contextFile: string
  /** Agent capabilities */
  capabilities: readonly string[]
}

/**
 * AI Agent Registry
 *
 * Maps agent emails to their configuration.
 * All cloud agents load ASTRID.md as their context file.
 * CLAUDE.md is for local Claude Code CLI only.
 */
/**
 * Suggested models for each AI service
 * Users can enter any model name (free-text), but these are shown as suggestions
 * Update this list as new models are released
 */
export const SUGGESTED_MODELS: Partial<Record<AIService, string[]>> = {
  claude: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-20250514',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
  ],
  gemini: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
  ],
  // Copilot exposes an OpenAI-compatible chat API, so the model names mirror
  // the OpenAI models GitHub proxies through the Copilot endpoint.
  // Copilot's GET /models advertises 44 ids, but its OpenAI-compatible chat
  // endpoint — the one we call — accepts only the GPT-4-era subset. Every id
  // here was verified with a live completion; claude-*, gemini-* and gpt-5*
  // are advertised yet return 400 model_not_supported, so they are excluded.
  copilot: [
    'gpt-4.1',
    'gpt-4o',
    'gpt-4o-mini',
  ],
}

/**
 * Default models for each service (first in the suggestions list)
 */
export const DEFAULT_MODELS: Partial<Record<AIService, string>> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  copilot: 'gpt-4.1',
}

const STANDARD_CAPABILITIES = [
  'code_generation',
  'code_review',
  'planning',
  'github_operations',
] as const

/**
 * Every agent this codebase knows how to route, keyed by mailbox. A deployment
 * enables a subset via BRAND_ENABLED_AGENTS; see ENABLED_AGENT_MAILBOXES below.
 *
 * `displayName` for the default assistant follows the brand, because that agent IS
 * the product's assistant persona. The others are named after their provider and
 * stay fixed — a fork does not rename Claude.
 */
const AGENT_DEFINITIONS: Record<string, AIAgentConfig> = {
  // The default agent identity — the underlying model is determined by user settings.
  astrid: {
    service: 'claude', // Default service; overridden by user's configured model at runtime
    model: 'claude-sonnet-4-6',
    displayName: BRAND.agentIdentityName,
    agentType: 'astrid_agent',
    contextFile: 'ASTRID.md',
    capabilities: STANDARD_CAPABILITIES,
  },
  claude: {
    service: 'claude',
    model: 'claude-sonnet-4-6',
    displayName: 'Claude Agent',
    agentType: 'claude_agent',
    contextFile: 'ASTRID.md',
    capabilities: STANDARD_CAPABILITIES,
  },
  openai: {
    service: 'openai',
    model: 'gpt-4o', // Reliable default model
    displayName: 'OpenAI Agent',
    agentType: 'openai_agent',
    contextFile: 'ASTRID.md',
    capabilities: STANDARD_CAPABILITIES,
  },
  gemini: {
    service: 'gemini',
    model: 'gemini-2.5-flash',
    displayName: 'Gemini Agent',
    agentType: 'gemini_agent',
    contextFile: 'ASTRID.md',
    capabilities: STANDARD_CAPABILITIES,
  },
  copilot: {
    service: 'copilot',
    model: 'gpt-4.1',
    displayName: 'GitHub Copilot Agent',
    agentType: 'copilot_agent',
    contextFile: 'ASTRID.md',
    capabilities: STANDARD_CAPABILITIES,
  },
  // OpenClaw agents connect via the channel plugin (outbound SSE), not assistant-workflow.
  // This config is kept for pattern matching and routing purposes.
  openclaw: {
    service: 'openclaw',
    model: 'anthropic/claude-opus-4-5',
    displayName: 'OpenClaw Worker (Channel Plugin)',
    agentType: 'openclaw_worker',
    contextFile: 'ASTRID.md',
    capabilities: [...STANDARD_CAPABILITIES, 'workflow_suggestions'],
  },
}

/** Mailboxes enabled by default when BRAND_ENABLED_AGENTS is unset — i.e. all of them. */
const ALL_AGENT_MAILBOXES = Object.keys(AGENT_DEFINITIONS)

/**
 * Which agents this deployment supports.
 *
 * `BRAND_ENABLED_AGENTS=claude,openai` narrows the set; unset means all. Unknown
 * names are ignored rather than throwing — a typo should not take down agent routing
 * at import time, and the resulting registry is still coherent.
 *
 * Deliberately not `NEXT_PUBLIC_`: this module is server-only (verified — no client
 * component imports it), and clients learn the enabled set from the available-agents
 * endpoint. A public var would let the browser bundle disagree with the server.
 *
 * The default assistant (`astrid`) is always present: it is the product's own
 * assistant identity, not a third-party provider, and dropping it would orphan every
 * task already assigned to it.
 */
function resolveEnabledMailboxes(): string[] {
  const configured = process.env.BRAND_ENABLED_AGENTS?.trim()
  if (!configured) return ALL_AGENT_MAILBOXES

  const requested = configured
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => name in AGENT_DEFINITIONS)

  return ALL_AGENT_MAILBOXES.filter(
    (mailbox) => mailbox === 'astrid' || requested.includes(mailbox)
  )
}

export const ENABLED_AGENT_MAILBOXES: readonly string[] = resolveEnabledMailboxes()

/**
 * AI Agent Registry — maps agent email to configuration.
 *
 * Built from AGENT_DEFINITIONS with brand-derived addresses, so the shape callers
 * see is unchanged from when this was a hardcoded literal.
 */
export const AI_AGENT_CONFIG: Record<string, AIAgentConfig> = Object.fromEntries(
  ENABLED_AGENT_MAILBOXES.map((mailbox) => [agentEmail(mailbox), AGENT_DEFINITIONS[mailbox]])
)

/**
 * Get agent configuration by email
 */
export function getAgentConfig(email: string): AIAgentConfig | null {
  // Exact match first
  if (AI_AGENT_CONFIG[email]) return AI_AGENT_CONFIG[email]

  // Pattern match for {name}.oc@<agent domain> → use openclaw config
  if (openClawEmailPattern().test(email)) {
    return AI_AGENT_CONFIG[agentEmail('openclaw')] || null
  }

  return null
}

/**
 * Get AI service for an agent email
 * Returns 'claude' as default if email not found
 */
export function getAgentService(email: string): AIService {
  return getAgentConfig(email)?.service || 'claude'
}

/**
 * Get the model for an agent email
 */
export function getAgentModel(email: string): string {
  return getAgentConfig(email)?.model || 'claude-sonnet-4-6'
}

/**
 * Get the context file for an agent (all cloud agents use ASTRID.md)
 */
export function getAgentContextFile(email: string): string {
  return getAgentConfig(email)?.contextFile || 'ASTRID.md'
}

/**
 * Check if an email is a registered AI agent
 */
export function isRegisteredAgent(email: string): boolean {
  return getAgentConfig(email) !== null
}

/**
 * Get all registered agent emails
 */
export function getRegisteredAgentEmails(): string[] {
  return Object.keys(AI_AGENT_CONFIG)
}

/**
 * Get all agent configs as an array
 */
export function getAllAgentConfigs(): Array<AIAgentConfig & { email: string }> {
  return Object.entries(AI_AGENT_CONFIG).map(([email, config]) => ({
    email,
    ...config,
  }))
}

/**
 * The built-in agents a user can be offered, given the API keys they hold.
 *
 * This is the list both available-agents routes iterate. It excludes `astrid` (added
 * separately as the always-first default) and `openclaw` (per-user registered workers,
 * discovered from the database rather than from this registry).
 *
 * Shape mirrors what those routes previously hardcoded, so they no longer keep their
 * own copies that could drift from the routing table.
 */
export interface BuiltInAgent {
  email: string
  /** Short provider name for the picker — not the routing `displayName`. */
  name: string
  service: Exclude<AIService, 'openclaw'>
  image: string
}

const BUILT_IN_AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  copilot: 'GitHub Copilot',
}

/**
 * The agent identity that backs a given service, or null if that service has no
 * enabled agent. Inverse of `getAgentService`.
 *
 * Replaces hand-written service→email maps (a ternary chain and a lookup object in
 * lib/ai-agent-comment-service.ts) that hardcoded addresses and silently went stale
 * whenever the registry changed. Task 97208a72.
 */
export function agentEmailForService(service: string | null | undefined): string | null {
  if (!service) return null

  // Skip the default assistant: its `service` is only a runtime fallback (it is
  // 'claude' today), so including it here would shadow the real claude@ agent and
  // silently reassign every Claude-backed task to the assistant identity.
  const mailbox = ENABLED_AGENT_MAILBOXES.find(
    (name) => name !== 'astrid' && AGENT_DEFINITIONS[name].service === service
  )

  return mailbox ? agentEmail(mailbox) : null
}

export function getBuiltInAgents(): BuiltInAgent[] {
  return ENABLED_AGENT_MAILBOXES
    .filter((mailbox) => mailbox in BUILT_IN_AGENT_NAMES)
    .map((mailbox) => ({
      email: agentEmail(mailbox),
      name: BUILT_IN_AGENT_NAMES[mailbox],
      service: AGENT_DEFINITIONS[mailbox].service as Exclude<AIService, 'openclaw'>,
      image: `/api/v1/agent-icon/${mailbox}`,
    }))
}
