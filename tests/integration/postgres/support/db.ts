/**
 * Shared plumbing for the real-Postgres tier (ADEV-294).
 *
 * Not a test file (no `.test.ts`), so the tier's include glob does not collect it.
 * Every suite here talks to a real database through the app's own `@/lib/prisma`
 * client, so a service under test runs exactly as it does in production: no mock
 * decides what the query returns.
 */
import type { PrismaClient } from '@prisma/client'

export function requireSafeTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests')
  }
  const url = new URL(value)
  const databaseName = url.pathname.slice(1).toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!isLocal || !databaseName.includes('test')) {
    throw new Error('TEST_DATABASE_URL must point to a localhost database whose name contains "test"')
  }
  return value
}

/** Point the app's client at the test database, then load it. Call from `beforeAll`. */
export async function connectAppPrisma(): Promise<PrismaClient> {
  const databaseUrl = requireSafeTestDatabaseUrl()
  process.env.DATABASE_URL = databaseUrl
  process.env.DATABASE_URL_DIRECT = databaseUrl
  const { prisma } = await import('@/lib/prisma')
  await prisma.$connect()
  return prisma
}

/** A prefix unique to this run and file, so parallel CI jobs and reruns never collide. */
export function runPrefix(name: string): string {
  return `pg-${name}-${process.pid}-${Date.now()}`
}

/** Rows of `_TaskToTaskList` (A = Task, B = TaskList) for a task, as list ids. */
export async function listIdsForTask(prisma: PrismaClient, taskId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ B: string }>>`
    SELECT "B" FROM "_TaskToTaskList" WHERE "A" = ${taskId} ORDER BY "B"
  `
  return rows.map(row => row.B)
}

/** Delete everything a suite created, found by its email/title prefix. */
export async function cleanupPrefix(prisma: PrismaClient, prefix: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  })
  const userIds = users.map(user => user.id)
  await prisma.task.deleteMany({
    where: { OR: [{ title: { startsWith: prefix } }, { creatorId: { in: userIds } }] },
  })
  await prisma.taskList.deleteMany({ where: { ownerId: { in: userIds } } })
  await prisma.project.deleteMany({ where: { ownerId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}
