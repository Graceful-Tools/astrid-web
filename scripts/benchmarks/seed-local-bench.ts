/**
 * Seeds a throwaway local database with what `npm run bench:agents` needs
 * (AWTD-1551): a user, a client-credentials pair and an access token.
 *
 *   npx tsx scripts/benchmarks/seed-local-bench.ts
 *
 * Seeds the database DATABASE_URL names and prints `ASTRID_BENCH_*` lines to paste
 * into the environment. Refuses any database that is not on localhost, so it
 * cannot seed a preview or production by mistake.
 */
import { createScriptPrisma } from '../lib/script-prisma'
import { generateAccessToken, hashClientSecret } from '../../lib/oauth/oauth-token-manager'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('DATABASE_URL must point to a localhost database')
}

const SCOPES = ['tasks:read', 'tasks:write', 'lists:read', 'lists:write']

async function main() {
  const prisma = createScriptPrisma()
  try {
    const user = await prisma.user.upsert({
      where: { email: 'bench-owner@example.test' },
      update: { isActive: true },
      create: { email: 'bench-owner@example.test', name: 'Bench Owner' },
    })
    const clientId = 'astrid_bench_client'
    const clientSecret = `bench_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const client = await prisma.oAuthClient.upsert({
      where: { clientId },
      update: { clientSecret: hashClientSecret(clientSecret), isActive: true, userId: user.id },
      create: {
        clientId,
        clientSecret: hashClientSecret(clientSecret),
        name: 'Agent benchmark (local)',
        userId: user.id,
        grantTypes: ['client_credentials'],
        scopes: SCOPES,
      },
    })
    const { accessToken } = await generateAccessToken(client.id, user.id, SCOPES)
    const list = await prisma.taskList.create({
      data: {
        name: 'Agent benchmark (throwaway)',
        color: '#888888',
        ownerId: user.id,
        listMembers: { create: { userId: user.id, role: 'admin' } },
      },
    })
    const task = await prisma.task.create({
      data: {
        title: 'Benchmark task',
        description: 'Throwaway task the agent benchmark reads and comments on.',
        creator: { connect: { id: user.id } },
        lists: { connect: { id: list.id } },
        statusRole: 'ready',
      },
    })
    console.log(`ASTRID_BENCH_LIST=${list.id}`)
    console.log(`ASTRID_BENCH_TASK=${task.id}`)
    console.log(`ASTRID_BENCH_TOKEN=${accessToken}`)
    console.log(`ASTRID_BENCH_CLIENT_ID=${clientId}`)
    console.log(`ASTRID_BENCH_CLIENT_SECRET=${clientSecret}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
