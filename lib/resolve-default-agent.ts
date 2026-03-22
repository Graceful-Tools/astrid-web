/**
 * Default AI Agent Resolution
 *
 * Resolves which AI agent should handle messages for a given list/user context.
 * Resolution order: list-level override → user-level default → null
 */

import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { getAgentService } from '@/lib/ai/agent-config'

// ─── aiAgentsEnabled normalization ────────────────────────────────

export interface AgentEnabledConfig {
  enabledTypes: string[]
  defaultAgentId?: string | null
}

/**
 * Normalize the `aiAgentsEnabled` JSON field which can be either:
 * - Legacy: string[] (e.g., ["coding", "claude"])
 * - New: { enabledTypes: string[], defaultAgentId?: string }
 */
export function normalizeAgentEnabledConfig(value: unknown): AgentEnabledConfig {
  if (!value) return { enabledTypes: [] }

  // Legacy: plain array of strings
  if (Array.isArray(value)) {
    return { enabledTypes: value.filter(v => typeof v === 'string') }
  }

  // New: object format
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return {
      enabledTypes: Array.isArray(obj.enabledTypes)
        ? obj.enabledTypes.filter((v: unknown) => typeof v === 'string')
        : [],
      defaultAgentId: typeof obj.defaultAgentId === 'string' ? obj.defaultAgentId : null,
    }
  }

  // String that might be JSON (from DB)
  if (typeof value === 'string') {
    try {
      return normalizeAgentEnabledConfig(JSON.parse(value))
    } catch {
      return { enabledTypes: [] }
    }
  }

  return { enabledTypes: [] }
}

/**
 * Get the enabled agent types from the normalized config.
 * Drop-in replacement for code that previously read aiAgentsEnabled as string[].
 */
export function getEnabledAgentTypes(aiAgentsEnabled: unknown): string[] {
  return normalizeAgentEnabledConfig(aiAgentsEnabled).enabledTypes
}

// ─── Agent resolution ─────────────────────────────────────────────

/**
 * Resolve the default AI agent for a given list/user context.
 *
 * @param listId - The list ID (null for virtual lists like "My Tasks")
 * @param userId - The current user's ID
 * @returns The agent's User ID, or null if no default agent is configured
 */
export async function resolveDefaultAgent(
  listId: string | null,
  userId: string
): Promise<string | null> {
  let agentId: string | null = null

  // 1. Check list-level override
  if (listId) {
    try {
      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        select: { aiAgentsEnabled: true },
      })
      if (list?.aiAgentsEnabled) {
        const config = normalizeAgentEnabledConfig(list.aiAgentsEnabled)
        if (config.defaultAgentId) {
          agentId = config.defaultAgentId
        }
      }
    } catch (error) {
      console.error('[resolveDefaultAgent] Error reading list config:', error)
    }
  }

  // 2. Fall back to user-level default
  if (!agentId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { aiAssistantSettings: true },
      })
      if (user?.aiAssistantSettings) {
        const settings = JSON.parse(user.aiAssistantSettings)
        if (settings.defaultAgentId) {
          agentId = settings.defaultAgentId
        }
      }
    } catch (error) {
      console.error('[resolveDefaultAgent] Error reading user settings:', error)
    }
  }

  if (!agentId) {
    console.log(`[resolveDefaultAgent] No agentId found for listId=${listId}, userId=${userId}`)
    return null
  }

  // 3. Validate: agent must exist and be an AI agent
  try {
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
      select: { id: true, isAIAgent: true, email: true, aiAgentType: true },
    })
    if (!agent?.isAIAgent) {
      console.log(`[resolveDefaultAgent] Agent ${agentId} not found or not AI agent`)
      return null
    }

    // 4. Validate: user must have API key for this agent's service
    // For Astrid (astrid@astrid.cc), check user's preferred service instead
    if (agent.email === 'astrid@astrid.cc') {
      const { getPreferredAIService } = await import('@/lib/api-key-cache')
      const preferredService = await getPreferredAIService(userId)
      const hasKey = await hasValidApiKey(userId, preferredService)
      if (!hasKey) {
        console.log(`[resolveDefaultAgent] No valid ${preferredService} API key for user ${userId}`)
        return null
      }
    } else {
      const service = getAgentService(agent.email) as 'claude' | 'openai' | 'gemini' | 'openclaw'
      const hasKey = await hasValidApiKey(userId, service)
      if (!hasKey) return null
    }

    return agent.id
  } catch (error) {
    console.error('[resolveDefaultAgent] Error validating agent:', error)
    return null
  }
}
