/**
 * Utility functions for AI agent type checking
 */

/**
 * Valid coding agent types that can perform GitHub operations
 */
const CODING_AGENT_TYPES = ['coding_agent', 'claude_agent', 'openai_agent', 'gemini_agent', 'openclaw_worker'] as const

/**
 * Check if an AI agent type is a valid coding agent
 * @param aiAgentType The AI agent type to check
 * @returns true if the agent type is a coding agent
 */
export function isCodingAgentType(aiAgentType: string | null | undefined): boolean {
  if (!aiAgentType) return false
  return CODING_AGENT_TYPES.includes(aiAgentType as any)
}

/**
 * Check if a user is a coding agent
 * @param user User object with isAIAgent and aiAgentType properties
 * @returns true if the user is a coding agent
 */
export function isCodingAgent(user: { isAIAgent?: boolean | null; aiAgentType?: string | null }): boolean {
  return user.isAIAgent === true && isCodingAgentType(user.aiAgentType)
}
