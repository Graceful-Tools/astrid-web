/**
 * Task f9ba26b3 — the weekly verify-email sweep.
 *
 * THE BUG THIS FIXES IS STARVATION, NOT JUST COST. The sweep asked for every
 * unverified user with no `take`, then spent 2-3 queries per user discovering
 * that most of them already had the task. The work never shrank the set it was
 * scanning, so a run killed by the 60-second budget re-processed the identical
 * prefix the following week and the tail was never reached — permanently, not
 * eventually.
 *
 * Bounding it with a `take` alone would have preserved that exactly. The fix is
 * to make the QUERY ask for users who actually need work: creating the task
 * removes the user from the result set, so the next page is genuinely new and
 * no resume cursor (or migration) is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindMany = vi.hoisted(() => vi.fn())
const taskCreateMany = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
const taskUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: {
      findMany: vi.fn(),
      findFirst: taskFindFirst,
      create: taskCreate,
      createMany: taskCreateMany,
      update: taskUpdate,
    },
  },
}))

// The module imports prisma by relative path ('./prisma'), which resolves to
// the same module as the alias — mocking one covers both.
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findMany: userFindMany, findUnique: userFindUnique },
    task: {
      findMany: vi.fn(),
      findFirst: taskFindFirst,
      create: taskCreate,
      createMany: taskCreateMany,
      update: taskUpdate,
    },
  },
}))

import {
  createVerifyEmailTasksForUnverifiedUsers,
  createVerifyEmailTask,
  buildVerifyEmailTaskData,
  SYSTEM_TASK_TITLES,
  VERIFY_EMAIL_BATCH_SIZE,
  MAX_VERIFY_EMAIL_USERS_PER_RUN,
} from '@/lib/system-tasks'

const users = (count: number, prefix = 'u') =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, email: `${prefix}${i}@x.test` }))

beforeEach(() => {
  vi.clearAllMocks()
  userFindMany.mockResolvedValue([])
  taskCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
})

describe('the sweep only asks for users who need work (task f9ba26b3)', () => {
  it('EXCLUDES users who already have an incomplete verify task, in the query', async () => {
    await createVerifyEmailTasksForUnverifiedUsers()

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailVerified: null,
          accounts: { none: {} },
          assignedTasks: {
            none: { title: SYSTEM_TASK_TITLES.VERIFY_EMAIL, completed: false },
          },
        }),
      }),
    )
  })

  it('bounds each page with a take', async () => {
    await createVerifyEmailTasksForUnverifiedUsers()

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: VERIFY_EMAIL_BATCH_SIZE }),
    )
  })

  it('writes a page in ONE query instead of three per user', async () => {
    userFindMany.mockResolvedValueOnce(users(4)).mockResolvedValue([])

    const stats = await createVerifyEmailTasksForUnverifiedUsers()

    expect(taskCreateMany).toHaveBeenCalledTimes(1)
    expect(taskCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ assigneeId: 'u-0' })]),
      }),
    )
    // The per-user existence and verification probes are what the query now
    // answers for the whole page.
    expect(taskFindFirst).not.toHaveBeenCalled()
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ processed: 4, created: 4, errors: 0 })
  })

  it('keeps paging while the shrinking set still yields users', async () => {
    userFindMany
      .mockResolvedValueOnce(users(VERIFY_EMAIL_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(users(3, 'b'))
      .mockResolvedValue([])

    const stats = await createVerifyEmailTasksForUnverifiedUsers()

    expect(stats.created).toBe(VERIFY_EMAIL_BATCH_SIZE + 3)
  })
})

describe('the sweep cannot spin (task f9ba26b3)', () => {
  it('STOPS when a page moves nobody out of the set', async () => {
    // The re-query hazard: the page is chosen by a predicate, so if the write
    // failed to change anything the identical page comes back forever.
    userFindMany.mockResolvedValue(users(5))
    taskCreateMany.mockResolvedValue({ count: 0 })

    const stats = await createVerifyEmailTasksForUnverifiedUsers()

    expect(userFindMany.mock.calls.length).toBeLessThanOrEqual(2)
    expect(stats.created).toBe(0)
  })

  it('stops and reports when a page write throws, rather than retrying it forever', async () => {
    userFindMany.mockResolvedValue(users(5))
    taskCreateMany.mockRejectedValue(new Error('db is down'))

    const stats = await createVerifyEmailTasksForUnverifiedUsers()

    expect(stats.errors).toBe(5)
    expect(userFindMany.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('stops at the per-run cap and says there is more waiting', async () => {
    userFindMany.mockImplementation(async ({ take }: { take: number }) => users(take))

    const stats = await createVerifyEmailTasksForUnverifiedUsers()

    expect(stats.processed).toBe(MAX_VERIFY_EMAIL_USERS_PER_RUN)
    expect(stats.capped).toBe(true)
  })

  it('never asks for more than the run has left in its budget', async () => {
    userFindMany.mockImplementation(async ({ take }: { take: number }) => users(take))

    await createVerifyEmailTasksForUnverifiedUsers()

    const requested = userFindMany.mock.calls.reduce(
      (sum: number, [arg]: [{ take: number }]) => sum + arg.take,
      0,
    )
    expect(requested).toBeLessThanOrEqual(MAX_VERIFY_EMAIL_USERS_PER_RUN)
  })
})

describe('single and batch paths build the SAME task (task f9ba26b3)', () => {
  it('shares one data builder, so the two paths cannot drift', async () => {
    // Previously the batch path went through createVerifyEmailTask, so the
    // shape could not diverge. Now that it does not, the shape is what is
    // shared instead — otherwise a user swept in by the cron would get a
    // different task from one created at signup.
    taskFindFirst.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ emailVerified: null, accounts: [] })
    taskCreate.mockResolvedValue({ id: 'task-1' })

    await createVerifyEmailTask('u-single')
    const singleData = taskCreate.mock.calls[0][0].data

    const builtData = buildVerifyEmailTaskData('u-single')

    expect(singleData).toEqual(builtData)
    expect(builtData).toMatchObject({
      title: SYSTEM_TASK_TITLES.VERIFY_EMAIL,
      assigneeId: 'u-single',
      creatorId: null,
      priority: 3,
      isPrivate: true,
      isAllDay: true,
    })
  })

  it('still refuses to create a duplicate on the single path', async () => {
    // The batch query now filters these out, but the single path is called from
    // signup and verification flows where nothing has pre-filtered.
    taskFindFirst.mockResolvedValue({ id: 'existing' })

    expect(await createVerifyEmailTask('u-single')).toEqual({
      created: false,
      taskId: 'existing',
    })
    expect(taskCreate).not.toHaveBeenCalled()
  })
})
