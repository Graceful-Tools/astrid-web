#!/usr/bin/env tsx
/**
 * Fail when the generated Prisma client has drifted from prisma/schema.prisma.
 *
 * The predeploy gate used to prove only that `@prisma/client` was requirable,
 * which is true of a stale client too. So a schema change surfaced as a wall of
 * tsc errors — `Property 'agentMailbox' does not exist on type '{ ...MCPToken
 * fields... }'` — and filed a "Predeploy Failed: TypeScript" task pointing at
 * source code that was perfectly correct (task ea700455).
 */
import { isPrismaClientStale, SCHEMA_PATH, GENERATED_SCHEMA_PATH } from './lib/prisma-client-freshness'

if (isPrismaClientStale()) {
  console.error(`❌ Generated Prisma client is out of date.`)
  console.error(`   ${SCHEMA_PATH} no longer matches ${GENERATED_SCHEMA_PATH}.`)
  console.error(`   Run: npx prisma generate`)
  process.exit(1)
}

console.log('✅ Generated Prisma client matches prisma/schema.prisma')
