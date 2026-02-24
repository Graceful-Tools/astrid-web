/**
 * Centralized AI Agent Configuration
 *
 * Single source of truth for all AI agent routing.
 * When a task is assigned to an agent email, this config determines:
 * - Which AI service to use (Claude, OpenAI, Gemini)
 * - Which model to use
 * - What context file to load (all cloud agents use ASTRID.md)
 */

export type AIService = 'claude' | 'openai' | 'gemini' | 'openclaw'

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
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-pro',
  ],
}

/**
 * Default models for each service (first in the suggestions list)
 */
export const DEFAULT_MODELS: Partial<Record<AIService, string>> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o', // Reliable default for OpenAI
  gemini: 'gemini-2.0-flash',
}

export const AI_AGENT_CONFIG: Record<string, AIAgentConfig> = {
  'claude@astrid.cc': {
    service: 'claude',
    model: 'claude-sonnet-4-20250514',
    displayName: 'Claude Agent',
    agentType: 'claude_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'openai@astrid.cc': {
    service: 'openai',
    model: 'gpt-4o', // Reliable default model
    displayName: 'OpenAI Agent',
    agentType: 'openai_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'gemini@astrid.cc': {
    service: 'gemini',
    model: 'gemini-2.0-flash',
    displayName: 'Gemini Agent',
    agentType: 'gemini_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  // OpenClaw agents connect via the channel plugin (outbound SSE), not assistant-workflow.
  // This config is kept for pattern matching and routing purposes.
  'openclaw@astrid.cc': {
    service: 'openclaw',
    model: 'anthropic/claude-opus-4-5',
    displayName: 'OpenClaw Worker (Channel Plugin)',
    agentType: 'openclaw_worker',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations', 'workflow_suggestions'],
  },
} as const

/**
 * Get agent configuration by email
 */
export function getAgentConfig(email: string): AIAgentConfig | null {
  // Exact match first
  if (AI_AGENT_CONFIG[email]) return AI_AGENT_CONFIG[email]

  // Pattern match for {name}.oc@astrid.cc → use openclaw config
  if (/^[a-z0-9._-]+\.oc@astrid\.cc$/i.test(email)) {
    return AI_AGENT_CONFIG['openclaw@astrid.cc'] || null
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
  return getAgentConfig(email)?.model || 'claude-sonnet-4-20250514'
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
