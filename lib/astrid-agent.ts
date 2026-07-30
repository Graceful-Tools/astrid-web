/**
 * Default Assistant Agent User
 *
 * Ensures the default assistant's agent user exists in the database. This is the
 * product's own assistant identity — powered by whichever model the user configures,
 * unlike claude@/openai@/gemini@ which name a specific provider.
 *
 * Address and display name come from the brand (task 97208a72). The export names keep
 * their ASTRID_* spelling so the existing importers are untouched.
 */

import { prisma } from '@/lib/prisma'
import { agentEmail } from '@/lib/brand/agent-emails'
import { BRAND } from '@/lib/brand/config'
import { createLogger } from '@/lib/logger'

const log = createLogger('astrid-agent')


export const ASTRID_EMAIL = agentEmail('astrid')
export const ASTRID_NAME = BRAND.agentIdentityName
export const ASTRID_IMAGE = '/icons/icon-96x96.png'

/**
 * Ensure the default assistant's agent user exists in the database.
 * Creates it if it doesn't exist. Returns the user record.
 */
export async function ensureAstridAgent() {
  let agent = await prisma.user.findFirst({
    where: { email: ASTRID_EMAIL },
    select: { id: true, name: true, email: true, image: true, isAIAgent: true },
  })

  if (!agent) {
    agent = await prisma.user.create({
      data: {
        email: ASTRID_EMAIL,
        name: ASTRID_NAME,
        image: ASTRID_IMAGE,
        isAIAgent: true,
        aiAgentType: 'astrid_agent',
      },
      select: { id: true, name: true, email: true, image: true, isAIAgent: true },
    })
    log.info(`[${ASTRID_NAME}] Created ${ASTRID_EMAIL} agent user: ${agent.id}`)
  }

  return agent
}

/**
 * Get the Astrid agent user ID (creates if needed).
 */
export async function getAstridAgentId(): Promise<string> {
  const agent = await ensureAstridAgent()
  return agent.id
}
