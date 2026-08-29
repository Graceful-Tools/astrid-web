/**
 * Default AI Agent Resolution
 *
 * Resolves which AI agent should handle messages for a given list/user context.
 * Resolution order: list-level override → user-level default → null
 */

import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { getAgentService, ON_DEVICE_MODEL_IDS } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('resolve-default-agent')


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

/** The agent config as every v1 list response carries it. */
export interface ListAgentWireFields {
  /** Enabled agent types. ALWAYS an array on the wire — see serializeListAgentFields. */
  aiAgentsEnabled: string[]
  /** The full config, for clients that know about the per-list default agent. */
  aiAgentConfig: { enabledTypes: string[]; defaultAgentId: string | null }
}

/**
 * Project the stored `aiAgentsEnabled` column onto the wire.
 *
 * The column holds the object form (normalizeAgentEnabledConfig stores it that
 * way), but the v1 contract for `aiAgentsEnabled` is `string[]`
 * (lib/api/api-contract.ts) and iOS/Mac decode it as `[String]?` with a
 * synthesized Codable — a dictionary there fails the decode of the WHOLE
 * /api/v1/lists response and the app falls back to zero lists. So the array
 * keeps its name and its shape, and the part only the web reads
 * (`defaultAgentId`) rides in a sibling old clients never look at.
 */
export function serializeListAgentFields(stored: unknown): ListAgentWireFields {
  const config = normalizeAgentEnabledConfig(stored)
  return {
    aiAgentsEnabled: config.enabledTypes,
    aiAgentConfig: { enabledTypes: config.enabledTypes, defaultAgentId: config.defaultAgentId ?? null },
  }
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
      log.error({ err: error }, '[resolveDefaultAgent] Error reading list config:')
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
      log.error({ err: error }, '[resolveDefaultAgent] Error reading user settings:')
    }
  }

  if (!agentId) {
    log.info(`[resolveDefaultAgent] No agentId found for listId=${listId}, userId=${userId}`)
    return null
  }

  // 2b. On-device models (e.g. Apple Foundation Models) are handled client-side — no server processing
  if ((ON_DEVICE_MODEL_IDS as readonly string[]).includes(agentId)) {
    log.info(`[resolveDefaultAgent] On-device model selected for userId=${userId}, skipping server resolution`)
    return null
  }

  // 3. Validate: agent must exist and be an AI agent
  try {
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
      select: { id: true, isAIAgent: true, email: true, aiAgentType: true },
    })
    if (!agent?.isAIAgent) {
      log.info(`[resolveDefaultAgent] Agent ${agentId} not found or not AI agent`)
      return null
    }

    // 4. Validate: user must have API key for this agent's service
    // For the default assistant, check the user's preferred service instead
    if (agent.email === ASTRID_EMAIL) {
      const { getPreferredAIService } = await import('@/lib/api-key-cache')
      const preferredService = await getPreferredAIService(userId)
      const hasKey = await hasValidApiKey(userId, preferredService)
      if (!hasKey) {
        log.info(`[resolveDefaultAgent] No valid ${preferredService} API key for user ${userId}`)
        return null
      }
    } else {
      const service = getAgentService(agent.email) as 'claude' | 'openai' | 'gemini' | 'copilot' | 'openclaw'
      const hasKey = await hasValidApiKey(userId, service)
      if (!hasKey) return null
    }

    return agent.id
  } catch (error) {
    log.error({ err: error }, '[resolveDefaultAgent] Error validating agent:')
    return null
  }
}
