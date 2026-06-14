/**
 * Per-user feature flags.
 *
 * Projects is shipped as an opt-in Beta: users enable it in Settings, which
 * reveals the Projects UI and unlocks the project create / share APIs.
 *
 * Reads are DEFENSIVE: the projectsBetaEnabled column lands on the production
 * migration only (preview deploys skip migrations), so a preview build may run
 * against a DB without the column. We swallow that error and default to false
 * rather than 500 — the feature simply reads as "off" until the column exists.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('feature-flags')

export async function getProjectsBetaEnabled(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { projectsBetaEnabled: true },
    })
    return !!user?.projectsBetaEnabled
  } catch (error) {
    log.error({ err: error }, 'projectsBetaEnabled read failed; defaulting to false')
    return false
  }
}

export async function setProjectsBetaEnabled(userId: string, enabled: boolean): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { projectsBetaEnabled: enabled },
    })
    return enabled
  } catch (error) {
    log.error({ err: error }, 'projectsBetaEnabled write failed')
    throw error
  }
}

/**
 * Guard for project create / share writes. Returns true when the user has
 * opted into the Projects Beta. Routes 403 when false.
 */
export async function requireProjectsBeta(userId: string): Promise<boolean> {
  return getProjectsBetaEnabled(userId)
}
