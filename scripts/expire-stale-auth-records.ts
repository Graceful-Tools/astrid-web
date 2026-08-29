#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const prisma = new PrismaClient({ log: ['error'] })

async function main() {
  const apply = process.argv.includes('--apply')
  const now = new Date()
  const invitationWhere = { expiresAt: { lt: now }, status: 'PENDING' as const }
  const tokenWhere = {
    emailTokenExpiresAt: { lt: now },
    emailVerificationToken: { not: null },
  }

  const [invitations, tokens] = await Promise.all([
    prisma.invitation.count({ where: invitationWhere }),
    prisma.user.count({ where: tokenWhere }),
  ])

  console.log(`Expired invitations: ${invitations}`)
  console.log(`Expired verification tokens: ${tokens}`)
  if (!apply) {
    console.log('Dry run only. Pass --apply to update these records.')
    return
  }

  const [expiredInvitations, clearedTokens] = await prisma.$transaction([
    prisma.invitation.updateMany({
      where: invitationWhere,
      data: { status: 'EXPIRED' },
    }),
    prisma.user.updateMany({
      where: tokenWhere,
      data: { emailVerificationToken: null, emailTokenExpiresAt: null },
    }),
  ])

  console.log(`Marked ${expiredInvitations.count} invitations expired.`)
  console.log(`Cleared ${clearedTokens.count} verification tokens.`)
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
