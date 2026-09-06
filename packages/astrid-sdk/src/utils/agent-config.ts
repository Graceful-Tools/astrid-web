/**
 * AI Agent Configuration
 *
 * Centralized configuration for AI agent routing.
 * Maps agent emails to their AI service providers.
 */

import type { AIService, AIAgentConfig } from '../types/index.js'
import { resolveApiBase, resolveOrigin } from '../config/api-base.js'

// Re-export types for consumers
export type { AIService, AIAgentConfig }

/**
 * Suggested models for each AI service
 * Users can enter any model name, but these are shown as suggestions
 */
export const SUGGESTED_MODELS: Record<AIService, string[]> = {
  claude: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-20250514',
  ],
  openai: [
    'gpt-4o',
    'gpt-5',
    'o4-mini',
  ],
  gemini: [
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
  ],
  copilot: [
    'gpt-4.1',
    'gpt-4o',
  ],
  openclaw: [
    'anthropic/claude-opus-4-5',
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o',
  ],
}

/**
 * Default models for each service
 */
export const DEFAULT_MODELS: Record<AIService, string> = {
  claude: 'claude-sonnet-4-6',
  // Was 'o4-mini', which never matched the server. lib/ai/agent-config.ts is
  // authoritative and says gpt-4o (task 979e1325).
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  copilot: 'gpt-4.1',
  openclaw: 'anthropic/claude-opus-4-5',
}

/**
 * The agent domain this SDK builds addresses on.
 *
 * Derived from the configured API origin, so pointing the SDK at a partner's
 * deployment gives `claude@<their domain>` rather than `claude@astrid.cc`
 * (task 979e1325). `ASTRID_AGENT_EMAIL_DOMAIN` overrides it for deployments
 * whose agent mailboxes live on a different domain from their web app.
 */
export function agentEmailDomain(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const configured = env?.ASTRID_AGENT_EMAIL_DOMAIN?.trim()
  if (configured) return configured

  return resolveOrigin().replace(/^https?:\/\//, '').replace(/^www\./, '')
}

/** The built-in agent mailboxes and what each one is, keyed by local part. */
const AGENT_DEFINITIONS: Record<string, AIAgentConfig> = {
  claude: {
    service: 'claude',
    model: DEFAULT_MODELS.claude,
    displayName: 'Claude Agent',
    agentType: 'claude_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  openai: {
    service: 'openai',
    model: DEFAULT_MODELS.openai,
    displayName: 'OpenAI Agent',
    agentType: 'openai_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  gemini: {
    service: 'gemini',
    model: DEFAULT_MODELS.gemini,
    displayName: 'Gemini Agent',
    agentType: 'gemini_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  copilot: {
    service: 'copilot',
    model: DEFAULT_MODELS.copilot,
    displayName: 'GitHub Copilot Agent',
    agentType: 'copilot_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  openclaw: {
    service: 'openclaw',
    model: DEFAULT_MODELS.openclaw,
    displayName: 'Custom Agent',
    agentType: 'openclaw_worker',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations', 'workflow_suggestions'],
  },
}

/**
 * AI Agent Registry — a LOCAL COPY of the server's routing table.
 *
 * @deprecated Prefer {@link fetchAgentConfig}, which asks the server. This
 * table was a fork of `lib/ai/agent-config.ts` that had already drifted: it
 * pinned OpenAI to a model the server does not use, had no `copilot` entry at
 * all, and hardcoded `@astrid.cc` addresses so it was wrong for every
 * deployment but one.
 *
 * Kept, and kept working, because it is a published synchronous export and
 * removing it would break consumers. Addresses now follow the configured
 * origin.
 */
export const AI_AGENT_CONFIG: Record<string, AIAgentConfig> = Object.fromEntries(
  Object.entries(AGENT_DEFINITIONS).map(([mailbox, config]) => [
    `${mailbox}@${agentEmailDomain()}`,
    config,
  ])
)

/**
 * Ask the server which agents this deployment actually offers.
 *
 * This is the source of truth: a deployment enables a subset via
 * BRAND_ENABLED_AGENTS, and the local table above cannot know which. The
 * endpoint is per-user and authenticated, because agent availability depends
 * on which provider keys the user has configured.
 *
 * Returns null when the request fails, so a caller can fall back to the static
 * table rather than lose the ability to route at all.
 */
export async function fetchAgentConfig(options: {
  token: string
  apiBase?: string
  fetchImpl?: typeof fetch
}): Promise<Array<AIAgentConfig & { email: string }> | null> {
  const base = resolveApiBase(options.apiBase)
  const doFetch = options.fetchImpl ?? fetch

  try {
    const response = await doFetch(`${base}/users/me/available-agents`, {
      headers: {
        'X-OAuth-Token': options.token,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) return null

    const body = (await response.json()) as { agents?: Array<Record<string, unknown>> }
    if (!Array.isArray(body.agents)) return null

    return body.agents.map((agent) => {
      const email = String(agent.email ?? '')
      const local = email.split('@')[0]
      const fallback = AGENT_DEFINITIONS[local]

      return {
        email,
        service: (agent.service as AIService) ?? fallback?.service ?? 'claude',
        model: (agent.model as string) ?? fallback?.model ?? DEFAULT_MODELS.claude,
        displayName: (agent.displayName as string) ?? fallback?.displayName ?? email,
        agentType: (agent.agentType as string) ?? fallback?.agentType ?? 'openclaw_worker',
        contextFile: fallback?.contextFile ?? 'ASTRID.md',
        capabilities: fallback?.capabilities ?? [],
      } as AIAgentConfig & { email: string }
    })
  } catch {
    return null
  }
}

/**
 * Get agent configuration by email
 */
export function getAgentConfig(email: string): AIAgentConfig | null {
  return AI_AGENT_CONFIG[email] || null
}

/**
 * Get AI service for an agent email
 * Returns 'claude' as default if email not found
 */
export function getAgentService(email: string): AIService {
  return AI_AGENT_CONFIG[email]?.service || 'claude'
}

/**
 * Get the model for an agent email
 */
export function getAgentModel(email: string): string {
  return AI_AGENT_CONFIG[email]?.model || 'claude-sonnet-4-6'
}

/**
 * Get the context file for an agent
 */
export function getAgentContextFile(email: string): string {
  return AI_AGENT_CONFIG[email]?.contextFile || 'ASTRID.md'
}

/**
 * Check if an email is a registered AI agent
 */
export function isRegisteredAgent(email: string): boolean {
  return email in AI_AGENT_CONFIG
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
