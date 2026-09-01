import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildListCreate,
  buildTaskCreate,
  buildUserCreate,
} from '@/tests/fixtures/prisma'

let prisma: PrismaClient
const runPrefix = `risk-integration-${process.pid}-${Date.now()}`

function requireSafeTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests')
  }

  const url = new URL(value)
  const databaseName = url.pathname.slice(1).toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!isLocal || !databaseName.includes('test')) {
    throw new Error(
      'TEST_DATABASE_URL must point to a localhost database whose name contains "test"'
    )
  }
  return value
}

beforeAll(async () => {
  const databaseUrl = requireSafeTestDatabaseUrl()
  process.env.DATABASE_URL = databaseUrl
  process.env.DATABASE_URL_DIRECT = databaseUrl

  const { PrismaClient } = await import('@prisma/client')
  prisma = new PrismaClient()
  await prisma.$connect()
})

afterAll(async () => {
  if (!prisma) return
  await prisma.task.deleteMany({ where: { title: { startsWith: runPrefix } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: runPrefix } } })
  await prisma.$disconnect()
})

describe('ephemeral PostgreSQL risk behavior', () => {
  it('has applied the real Prisma migration history', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
    `
    expect(Number(rows[0]?.count)).toBeGreaterThan(0)
  })

  it('rolls back a failed transaction and preserves unique constraints', async () => {
    const email = `${runPrefix}-transaction@example.test`

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: buildUserCreate({ email }) })
        await tx.user.create({ data: buildUserCreate({ email }) })
      })
    ).rejects.toMatchObject({ code: 'P2002' })

    await expect(prisma.user.count({ where: { email } })).resolves.toBe(0)
  })

  it('cascades task children when their parent is deleted', async () => {
    const owner = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-cascade@example.test` }),
    })
    const list = await prisma.taskList.create({ data: buildListCreate(owner.id) })
    const task = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, { title: `${runPrefix}-cascade-task` }),
    })
    const comment = await prisma.comment.create({
      data: { taskId: task.id, authorId: owner.id, content: 'cascade sentinel' },
    })

    await prisma.task.delete({ where: { id: task.id } })

    await expect(prisma.comment.findUnique({ where: { id: comment.id } })).resolves.toBeNull()
  })

  it('round-trips JSON and representative nested membership query shapes', async () => {
    const owner = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-owner@example.test` }),
    })
    const member = await prisma.user.create({
      data: buildUserCreate({ email: `${runPrefix}-member@example.test` }),
    })
    const repeatingData = { unit: 'week', interval: 2, weekdays: ['MON', 'FRI'] }
    const list = await prisma.taskList.create({
      data: {
        ...buildListCreate(owner.id),
        listMembers: { create: { userId: member.id, role: 'member' } },
      },
    })
    const task = await prisma.task.create({
      data: buildTaskCreate(owner.id, list.id, {
        title: `${runPrefix}-query-task`,
        repeating: 'custom',
        repeatingData,
      }),
    })

    const visible = await prisma.task.findMany({
      where: {
        id: task.id,
        lists: { some: { listMembers: { some: { userId: member.id } } } },
      },
      select: {
        id: true,
        repeatingData: true,
        lists: { select: { id: true, listMembers: { select: { userId: true, role: true } } } },
      },
    })

    expect(visible).toEqual([
      {
        id: task.id,
        repeatingData,
        lists: [
          {
            id: list.id,
            listMembers: [{ userId: member.id, role: 'member' }],
          },
        ],
      },
    ])
  })
})
