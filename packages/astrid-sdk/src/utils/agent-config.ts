/**
 * AI Agent Configuration
 *
 * Centralized configuration for AI agent routing.
 * Maps agent emails to their AI service providers.
 */

import type { AIService, AIAgentConfig } from '../types/index.js'

// Re-export types for consumers
export type { AIService, AIAgentConfig }

/**
 * Suggested models for each AI service
 * Users can enter any model name, but these are shown as suggestions
 */
export const SUGGESTED_MODELS: Record<AIService, string[]> = {
  claude: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
  ],
  openai: [
    'o4-mini',
    'gpt-5',
    'gpt-4o',
  ],
  gemini: [
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
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
  claude: 'claude-sonnet-4-20250514',
  openai: 'o4-mini',
  gemini: 'gemini-2.5-flash',
  openclaw: 'anthropic/claude-opus-4-5',
}

/**
 * AI Agent Registry
 *
 * Maps agent emails to their configuration.
 * All cloud agents load ASTRID.md as their context file.
 */
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
    model: 'o4-mini',
    displayName: 'OpenAI Agent',
    agentType: 'openai_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'gemini@astrid.cc': {
    service: 'gemini',
    model: 'gemini-2.5-flash',
    displayName: 'Gemini Agent',
    agentType: 'gemini_agent',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations'],
  },
  'openclaw@astrid.cc': {
    service: 'openclaw',
    model: 'anthropic/claude-opus-4-5',
    displayName: 'OpenClaw Worker',
    agentType: 'openclaw_worker',
    contextFile: 'ASTRID.md',
    capabilities: ['code_generation', 'code_review', 'planning', 'github_operations', 'workflow_suggestions'],
  },
} as const

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
  return AI_AGENT_CONFIG[email]?.model || 'claude-sonnet-4-20250514'
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
