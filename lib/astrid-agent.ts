/**
 * Astrid Agent User
 *
 * Ensures the astrid@astrid.cc user exists in the database.
 * Astrid is the default agent identity — powered by whichever model the user configures.
 */

import { prisma } from '@/lib/prisma'

export const ASTRID_EMAIL = 'astrid@astrid.cc'
export const ASTRID_NAME = 'Astrid'
export const ASTRID_IMAGE = '/icons/icon-96x96.png'

/**
 * Ensure the astrid@astrid.cc agent user exists in the database.
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
    console.log(`[Astrid] Created astrid@astrid.cc agent user: ${agent.id}`)
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
