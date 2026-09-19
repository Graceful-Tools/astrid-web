#!/usr/bin/env npx tsx
/**
 * Stamp existing agent connections with the scope group they were provisioned
 * from, so `reconcileClientScopes` can top them up on their next token request
 * (AWTD-962).
 *
 * WHY THIS EXISTS. `reconcileClientScopes` shipped and works, but its first
 * bound is "no group, no change" — deliberately, so nothing gained a scope
 * merely because the feature landed. The consequence is that it is a no-op
 * until something records the group, and on 2026-09-19 every one of the 23
 * `OAuthClient` rows in production carried `scopeGroup: null`. So the promise
 * that an existing connection would "catch up on use" was, for every existing
 * connection, false.
 *
 * WHAT THIS DOES NOT DO, and why. It does not guess. Only clients owned by a
 * user with `isAIAgent: true` are candidates — those are agent connections by
 * construction (`OpenClaw Agent: neo`, `Astrid Agent`, `iOS Fixall Actions`,
 * `Custom Agent: muse`). A connection that a PERSON created in Settings and
 * points an agent harness at looks identical in the database to any other
 * client they own, and production holds third-party clients belonging to other
 * accounts. Widening those on a guess is not a backfill, it is a privilege
 * grant to strangers.
 *
 * Those human-owned connections — `github vscode` and `Fixall scripts and
 * Actions`, the two the `/fixall` loop actually authenticates as — are adopted
 * by their owner from Settings → API Access instead, or named here explicitly
 * with `--client`. That affordance is the real fix; this script is for the
 * rows that can be identified without a judgement call.
 *
 * Usage:
 *   npx tsx scripts/backfill-agent-scope-groups.ts                  # dry run
 *   npx tsx scripts/backfill-agent-scope-groups.ts --apply          # writes
 *   npx tsx scripts/backfill-agent-scope-groups.ts --client <id>    # one named client
 *   npx tsx scripts/backfill-agent-scope-groups.ts --group readonly # a different group
 *   npx tsx scripts/backfill-agent-scope-groups.ts --prod           # against production
 *
 * DRY RUN IS THE DEFAULT. `--apply` is the only thing that writes.
 *
 * The group is always NAMED — `ai_agent` unless `--group` says otherwise — and
 * validated against `SCOPE_GROUPS` before anything is read, never "everything
 * in the enum" and never the wildcard. The scopes themselves are written by
 * `reconcileClientScopes`, so bounds 2-4 are applied by the same code that
 * applies them at token issuance rather than by a second copy here.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

import { PrismaClient } from '@prisma/client'
import { SCOPE_GROUPS, isScopeGroup, type ScopeGroup } from '../lib/oauth/oauth-scopes'

interface Options {
  apply: boolean
  group: ScopeGroup
  clientIds: string[]
  prod: boolean
}

function parseArgs(argv: string[]): Options {
  const apply = argv.includes('--apply')
  const prod = argv.includes('--prod')
  const clientIds: string[] = []

  let group = 'ai_agent'

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--group') {
      group = argv[i + 1] ?? ''
      i++
    } else if (argv[i] === '--client') {
      const value = argv[i + 1]
      if (!value) throw new Error('--client needs a clientId')
      clientIds.push(value)
      i++
    }
  }

  // Bound 4, before a single row is read: an unrecognised name grants nothing
  // rather than defaulting open. '*' is not a group name and fails here too.
  if (!isScopeGroup(group)) {
    throw new Error(
      `Unknown scope group: ${group}. Known groups: ${Object.keys(SCOPE_GROUPS).join(', ')}`,
    )
  }

  return { apply, group, clientIds, prod }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const url = options.prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      options.prod
        ? 'DATABASE_URL_PROD is not set in .env.local'
        : 'DATABASE_URL is not set in .env.local',
    )
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } })

  try {
    // Explicitly named clients are taken as given — someone decided. Otherwise
    // only clients owned by an agent USER qualify; see the header for why that
    // predicate and no broader one.
    const where = options.clientIds.length
      ? { clientId: { in: options.clientIds } }
      : { scopeGroup: null, user: { isAIAgent: true } }

    const candidates = await prisma.oAuthClient.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        name: true,
        scopes: true,
        scopeGroup: true,
        user: { select: { email: true, isAIAgent: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (candidates.length === 0) {
      console.log('No candidate connections — nothing to stamp.')
      return
    }

    const target = SCOPE_GROUPS[options.group]

    console.log(
      `${options.apply ? 'APPLYING' : 'DRY RUN'} — group "${options.group}" ` +
        `(${target.length} scopes) against ${options.prod ? 'PRODUCTION' : 'the local database'}\n`,
    )

    let wouldChange = 0

    for (const client of candidates) {
      const held = new Set(client.scopes)
      const wouldAdd = target.filter(scope => scope !== '*' && !held.has(scope))

      console.log(`${client.name}  (…${client.clientId.slice(-6)})`)
      console.log(`  owner:       ${client.user?.email ?? '—'}`)
      console.log(`  scopeGroup:  ${client.scopeGroup ?? 'null'} → ${options.group}`)
      console.log(`  would add:   ${wouldAdd.length ? wouldAdd.join(', ') : '(nothing — already current)'}`)

      if (wouldAdd.length || client.scopeGroup !== options.group) wouldChange++

      if (options.apply) {
        // Stamp only. The scopes are written by reconcileClientScopes on the
        // client's next token request, through the same bounds that apply
        // everywhere else — this script never writes `scopes` itself.
        await prisma.oAuthClient.update({
          where: { id: client.id },
          data: { scopeGroup: options.group },
        })
        console.log('  stamped.')
      }

      console.log('')
    }

    console.log(
      options.apply
        ? `Stamped ${candidates.length} connection(s). Scopes catch up on each one's next token request.`
        : `${wouldChange} of ${candidates.length} connection(s) would change. Re-run with --apply to write.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
