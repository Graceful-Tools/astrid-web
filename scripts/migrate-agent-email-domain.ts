#!/usr/bin/env tsx
/**
 * Move existing AI agent identities to a new agent-email domain.
 *
 * Task 97208a72. Agent addresses are `<mailbox>@<BRAND_AGENT_EMAIL_DOMAIN>`. A fresh
 * deployment needs nothing — lib/ai/ensure-agent-user.ts creates each agent's User row
 * lazily at the configured domain. This script is only for an EXISTING deployment that
 * changes `BRAND_AGENT_EMAIL_DOMAIN` after agent rows already exist.
 *
 * Deliberately NOT a Prisma migration:
 *   - the target domain is deploy-time configuration, and migration SQL is static;
 *   - migrations run on every production deploy, where this is a no-op for Astrid;
 *   - renaming live identities is an operational decision, not a schema change.
 *
 * Safe because Task.assigneeId is foreign-keyed to User.id, not to the email — every
 * row keeps its id, so no task is reassigned or orphaned. Idempotent: re-running finds
 * nothing left to move.
 *
 *   npx tsx scripts/migrate-agent-email-domain.ts --from astrid.cc          # dry run
 *   npx tsx scripts/migrate-agent-email-domain.ts --from astrid.cc --apply
 *
 * `--to` defaults to BRAND_AGENT_EMAIL_DOMAIN from the environment.
 */

import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const APPLY = process.argv.includes('--apply')
const FROM = arg('from')
const TO = arg('to') || process.env.BRAND_AGENT_EMAIL_DOMAIN || process.env.NEXT_PUBLIC_BRAND_DOMAIN

if (!FROM || !TO) {
  console.error('❌ Usage: --from <old-domain> [--to <new-domain>] [--apply]')
  console.error('   --to defaults to BRAND_AGENT_EMAIL_DOMAIN / NEXT_PUBLIC_BRAND_DOMAIN.')
  process.exit(1)
}

if (FROM === TO) {
  console.log(`✅ Nothing to do — agent domain is already "${TO}".`)
  process.exit(0)
}

const prisma = new PrismaClient()

async function main() {
  const agents = await prisma.user.findMany({
    where: { isAIAgent: true, email: { endsWith: `@${FROM}` } },
    select: { id: true, email: true, name: true },
  })

  if (agents.length === 0) {
    console.log(`✅ No AI agent rows at @${FROM} — nothing to migrate.`)
    return
  }

  console.log(`\n${APPLY ? '🚚 Migrating' : '🔍 Dry run —'} ${agents.length} agent identit${agents.length === 1 ? 'y' : 'ies'}: @${FROM} → @${TO}\n`)

  // A row may already exist at the target address (e.g. a partially-completed run).
  // User.email is unique, so renaming into it would throw — report and skip instead.
  const targets = agents.map((a) => `${a.email!.split('@')[0]}@${TO}`)
  const collisions = new Set(
    (
      await prisma.user.findMany({
        where: { email: { in: targets } },
        select: { email: true },
      })
    ).map((u) => u.email!)
  )

  let moved = 0
  let skipped = 0

  for (const agent of agents) {
    const next = `${agent.email!.split('@')[0]}@${TO}`

    if (collisions.has(next)) {
      console.log(`   ⚠️  skip  ${agent.email} → ${next} (target address already exists)`)
      skipped++
      continue
    }

    if (APPLY) {
      // id is untouched, so Task.assigneeId keeps pointing at this same row.
      await prisma.user.update({ where: { id: agent.id }, data: { email: next } })
    }
    console.log(`   ${APPLY ? '✓' : '·'}  ${agent.email} → ${next}`)
    moved++
  }

  console.log(
    `\n${APPLY ? '✅ Migrated' : '📋 Would migrate'} ${moved} identit${moved === 1 ? 'y' : 'ies'}` +
      (skipped ? `, skipped ${skipped}` : '') +
      (APPLY ? '' : '\n   Re-run with --apply to commit.')
  )
}

main()
  .catch((err) => {
    console.error('❌ Migration failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
