import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildListCreate, buildUserCreate } from '@/tests/fixtures/prisma'
import { cleanupPrefix, connectAppPrisma, listIdsForTask, runPrefix } from './support/db'

/**
 * ADEV-294: task create/update with `listIds`, asserted on the join table itself.
 *
 * `_TaskToTaskList` is Prisma's implicit many-to-many: column A is the Task, B is the
 * TaskList (alphabetical model order). Read backwards, `WHERE "A" = $listId` returns a
 * plausible zero, and a mocked client cannot notice. These tests count both directions.
 */
let prisma: PrismaClient
const prefix = runPrefix('membership')

beforeAll(async () => {
  prisma = await connectAppPrisma()
})

afterAll(async () => {
  if (prisma) {
    await cleanupPrefix(prisma, prefix)
    await prisma.$disconnect()
  }
})

async function seed() {
  const owner = await prisma.user.create({
    data: buildUserCreate({ email: `${prefix}-${Math.random().toString(36).slice(2)}@example.test` }),
  })
  const listA = await prisma.taskList.create({ data: buildListCreate(owner.id) })
  const listB = await prisma.taskList.create({ data: buildListCreate(owner.id) })
  return { owner, listA, listB }
}

describe('task create/update with listIds against the real join table (ADEV-294)', () => {
  it('writes one _TaskToTaskList row per list, with A = task and B = list', async () => {
    const { owner, listA, listB } = await seed()
    const { createTaskWithSideEffects } = await import('@/services/task.service')

    const result = await createTaskWithSideEffects({
      input: { title: `${prefix}-create`, listIds: [listA.id, listB.id] },
      actorId: owner.id,
      actorName: 'Owner',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const taskId = result.task.id

    expect(await listIdsForTask(prisma, taskId)).toEqual([listA.id, listB.id].sort())

    // The direction that matters: the list is B, so the task counts under B and never under A.
    const asTask = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "_TaskToTaskList" WHERE "A" = ${listA.id}`
    const asList = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "_TaskToTaskList" WHERE "B" = ${listA.id}`
    expect(Number(asTask[0].n)).toBe(0)
    expect(Number(asList[0].n)).toBe(1)

    // And the relation reads back the same from both models.
    const fromList = await prisma.taskList.findUnique({
      where: { id: listB.id },
      select: { tasks: { select: { id: true } } },
    })
    expect(fromList?.tasks.map(t => t.id)).toEqual([taskId])
  })

  it('replaces the membership set on update, adding and removing rows', async () => {
    const { owner, listA, listB } = await seed()
    const { createTaskWithSideEffects, updateTaskWithSideEffects } = await import('@/services/task.service')

    const created = await createTaskWithSideEffects({
      input: { title: `${prefix}-update`, listIds: [listA.id] },
      actorId: owner.id,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const updated = await updateTaskWithSideEffects({
      taskId: created.task.id,
      actorId: owner.id,
      intent: { listIds: [listB.id] },
    })
    expect(updated.ok).toBe(true)

    expect(await listIdsForTask(prisma, created.task.id)).toEqual([listB.id])
    const stale = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "_TaskToTaskList" WHERE "A" = ${created.task.id} AND "B" = ${listA.id}`
    expect(Number(stale[0].n)).toBe(0)
  })

  it('refuses a list the actor cannot write to and leaves no membership row', async () => {
    const { owner } = await seed()
    const stranger = await prisma.user.create({
      data: buildUserCreate({ email: `${prefix}-stranger-${Math.random().toString(36).slice(2)}@example.test` }),
    })
    const strangersList = await prisma.taskList.create({ data: buildListCreate(stranger.id) })
    const { createTaskWithSideEffects } = await import('@/services/task.service')

    const result = await createTaskWithSideEffects({
      input: { title: `${prefix}-forbidden`, listIds: [strangersList.id] },
      actorId: owner.id,
    })

    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "_TaskToTaskList" WHERE "B" = ${strangersList.id}`
    expect(Number(rows[0].n)).toBe(0)
    if (result.ok) {
      // A surface may fall back to the actor's default lists rather than refuse; either way
      // the stranger's list must hold nothing.
      expect(await listIdsForTask(prisma, result.task.id)).not.toContain(strangersList.id)
    }
  })
})
