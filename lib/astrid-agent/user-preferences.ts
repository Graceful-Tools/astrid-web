/**
 * Load the user's AI preferences (model + email) for the Astrid agent.
 *
 * Both processAstridMessage and processAstridComment did the same Prisma
 * lookup + JSON.parse + modelPreferences[service] dereference. Centralising
 * here so the parse-failure path is handled in one place and a
 * mcpSettings schema change updates one site instead of two.
 */

import { prisma } from '@/lib/prisma'
import type { AIService } from '@/lib/ai/agent-config'

export interface UserAIPreferences {
  /** User's preferred model for this AI service, if set. */
  model: string | undefined
  /** User's email; falls back to '' so callers can avoid undefined-checks. */
  email: string
}

export async function loadUserAIPreferences(
  userId: string,
  service: AIService,
): Promise<UserAIPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpSettings: true, email: true },
  })

  let mcpSettings: Record<string, unknown> = {}
  if (user?.mcpSettings) {
    try {
      mcpSettings = JSON.parse(user.mcpSettings)
    } catch {
      mcpSettings = {}
    }
  }

  const modelPreferences = mcpSettings.modelPreferences as Record<string, string> | undefined
  return {
    model: modelPreferences?.[service],
    email: user?.email || '',
  }
}
