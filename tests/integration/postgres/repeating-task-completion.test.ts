import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildListCreate, buildTaskCreate, buildUserCreate } from '@/tests/fixtures/prisma'
import '@/tests/support/install-repeating-core'
import { cleanupPrefix, connectAppPrisma, listIdsForTask, runPrefix } from './support/db'

/**
 * ADEV-294: completing a task through `updateTaskWithSideEffects` (services/task-completion.ts
 * decides the stamp and lane), asserted on the rows left behind. The repeating case is the one
 * that matters: completing an occurrence must roll the SAME task forward, not kill the series.
 */
let prisma: PrismaClient
const prefix = runPrefix('complete')

beforeAll(async () => {
  prisma = await connectAppPrisma()
})

afterAll(async () => {
  if (prisma) {
    await cleanupPrefix(prisma, prefix)
    await prisma.$disconnect()
  }
})

async function seed(taskExtra: Record<string, unknown>) {
  const owner = await prisma.user.create({
    data: buildUserCreate({ email: `${prefix}-${Math.random().toString(36).slice(2)}@example.test` }),
  })
  const list = await prisma.taskList.create({ data: buildListCreate(owner.id) })
  const task = await prisma.task.create({
    data: buildTaskCreate(owner.id, list.id, { title: `${prefix}-task`, ...taskExtra }),
  })
  return { owner, list, task }
}

describe('task completion against real rows (ADEV-294)', () => {
  it('stamps a plain task done and clears its board lane, remembering where it was', async () => {
    const { owner, task } = await seed({ statusRole: 'doing' })
    const { updateTaskWithSideEffects } = await import('@/services/task.service')

    const result = await updateTaskWithSideEffects({
      taskId: task.id,
      actorId: owner.id,
      intent: { completed: true },
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rolledForward).toBe(false)
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.completed).toBe(true)
    expect(row.completedAt).toBeInstanceOf(Date)
    expect(row.statusRole).toBeNull()
    expect(row.statusRoleBeforeDone).toBe('doing')
  })

  it('reopening puts the task back in the lane it came from', async () => {
    const { owner, task } = await seed({ statusRole: 'doing' })
    const { updateTaskWithSideEffects } = await import('@/services/task.service')
    await updateTaskWithSideEffects({ taskId: task.id, actorId: owner.id, intent: { completed: true } })

    await updateTaskWithSideEffects({ taskId: task.id, actorId: owner.id, intent: { completed: false } })

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.completed).toBe(false)
    expect(row.completedAt).toBeNull()
    expect(row.statusRole).toBe('doing')
  })

  it('rolls a daily repeating task to its next occurrence instead of completing it', async () => {
    const due = new Date('2026-03-10T12:00:00.000Z')
    const { owner, list, task } = await seed({
      repeating: 'daily',
      repeatFrom: 'DUE_DATE',
      dueDateTime: due,
      statusRole: 'doing',
    })
    const { updateTaskWithSideEffects } = await import('@/services/task.service')

    const result = await updateTaskWithSideEffects({
      taskId: task.id,
      actorId: owner.id,
      intent: { completed: true, timeZone: 'UTC' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rolledForward).toBe(true)

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.completed).toBe(false)
    expect(row.completedAt).toBeNull()
    expect(row.occurrenceCount).toBe(1)
    expect(row.dueDateTime?.toISOString()).toBe('2026-03-11T12:00:00.000Z')
    // The series survives on the same row, still on its list.
    expect(await listIdsForTask(prisma, task.id)).toEqual([list.id])
    await expect(prisma.task.count({ where: { title: `${prefix}-task`, creatorId: owner.id } })).resolves.toBe(1)
  })

  it('counts each completion once across successive rollovers', async () => {
    const { owner, task } = await seed({
      repeating: 'daily',
      repeatFrom: 'DUE_DATE',
      dueDateTime: new Date('2026-03-10T12:00:00.000Z'),
    })
    const { updateTaskWithSideEffects } = await import('@/services/task.service')

    for (let i = 0; i < 3; i++) {
      const result = await updateTaskWithSideEffects({
        taskId: task.id,
        actorId: owner.id,
        intent: { completed: true, timeZone: 'UTC' },
      })
      expect(result.ok).toBe(true)
    }

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(row.occurrenceCount).toBe(3)
    expect(row.completed).toBe(false)
    expect(row.dueDateTime?.toISOString()).toBe('2026-03-13T12:00:00.000Z')
  })
})
