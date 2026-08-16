/**
 * Task d8de37c1 — the outbound leg. Jon: "Make it directional."
 *
 * The two cases that decide whether this is safe to run on a cron:
 *
 *   THE FEEDBACK LOOP. Pushing bumps the issue's updated_at on GitHub. If the
 *   PATCH response's timestamp is not written back into remoteUpdatedAt, the
 *   next pull sees a newer remote change and applies our own echo back inbound
 *   — a write every cycle, and an infinite oscillation if any normalization
 *   differs (trailing newline, CRLF).
 *
 *   THE FIRST-RUN CLOBBER. Every link written by the inbound leg has a null
 *   astridUpdatedAt, because it has never pushed. Treating null as "push it"
 *   would overwrite GitHub with Astrid's copy for every previously-imported
 *   task on the very first run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { externalTaskLink: { findMany, update } },
}))

const githubRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/github', () => ({ githubRequest }))

import { pushTasksForLink, directionPulls, directionPushes } from '@/lib/sync/github/push-tasks'

const LINK = {
  id: 'link-1',
  userId: 'user-1',
  astridListId: 'list-1',
  remoteContainerId: 'owner/repo',
  direction: 'BIDIRECTIONAL',
}

const OLD = new Date('2026-08-15T09:00:00Z')
const NEW = new Date('2026-08-15T10:00:00Z')

const etl = (over: Record<string, unknown> = {}) => ({
  id: 'etl-1',
  remoteId: 'owner/repo#7',
  astridUpdatedAt: OLD,
  task: {
    id: 'task-1',
    title: 'Fix the thing',
    description: 'edited in Astrid',
    completed: false,
    closedReason: null,
    updatedAt: NEW,
  },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  githubRequest.mockResolvedValue({ status: 200, json: { updated_at: '2026-08-15T10:00:05Z' } })
})

describe('direction decides which legs run (task d8de37c1)', () => {
  it('EXPORT pushes and does not pull', () => {
    expect(directionPushes('EXPORT')).toBe(true)
    expect(directionPulls('EXPORT')).toBe(false)
  })

  it('IMPORT pulls and does not push', () => {
    expect(directionPushes('IMPORT')).toBe(false)
    expect(directionPulls('IMPORT')).toBe(true)
  })

  it('BIDIRECTIONAL does both', () => {
    expect(directionPushes('BIDIRECTIONAL')).toBe(true)
    expect(directionPulls('BIDIRECTIONAL')).toBe(true)
  })

  it('an IMPORT link pushes nothing, without even querying', async () => {
    const result = await pushTasksForLink({ link: { ...LINK, direction: 'IMPORT' }, token: 't' })
    expect(result).toMatchObject({ pushed: 0 })
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('pushTasksForLink (task d8de37c1)', () => {
  it('PATCHes an issue whose task changed since the last push', async () => {
    findMany.mockResolvedValue([etl()])

    const result = await pushTasksForLink({ link: LINK, token: 't' })

    expect(result).toMatchObject({ pushed: 1 })
    expect(githubRequest).toHaveBeenCalledWith(
      't', 'PATCH', '/repos/owner/repo/issues/7',
      expect.objectContaining({ title: 'Fix the thing', body: 'edited in Astrid', state: 'open' }),
    )
  })

  it("writes the PATCH response's updated_at back, which is what closes the loop", async () => {
    // Without this the pull sees a newer remote timestamp than it recorded and
    // applies our own push back inbound, forever.
    findMany.mockResolvedValue([etl()])

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          astridUpdatedAt: NEW,
          remoteUpdatedAt: new Date('2026-08-15T10:00:05Z'),
        }),
      }),
    )
  })

  it('SEEDS rather than pushes when it has never pushed before', async () => {
    // The first-run clobber: null means "no baseline", not "send everything".
    findMany.mockResolvedValue([etl({ astridUpdatedAt: null })])

    const result = await pushTasksForLink({ link: LINK, token: 't' })

    expect(result).toMatchObject({ seeded: 1, pushed: 0 })
    expect(githubRequest).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { astridUpdatedAt: NEW } }),
    )
  })

  it('skips a task that has not changed since the last push', async () => {
    findMany.mockResolvedValue([etl({ astridUpdatedAt: NEW })])

    expect(await pushTasksForLink({ link: LINK, token: 't' })).toMatchObject({
      skipped: 1,
      pushed: 0,
    })
    expect(githubRequest).not.toHaveBeenCalled()
  })

  it('closes the issue with the right state_reason when the task is canceled', async () => {
    findMany.mockResolvedValue([
      etl({ task: { ...etl().task, completed: true, closedReason: 'canceled' } }),
    ])

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(githubRequest).toHaveBeenCalledWith(
      't', 'PATCH', expect.any(String),
      expect.objectContaining({ state: 'closed', state_reason: 'not_planned' }),
    )
  })

  it('leaves watermarks untouched when GitHub rejects the push', async () => {
    // A failed push must be retried next run, not silently marked as done.
    githubRequest.mockResolvedValue({ status: 422, json: { message: 'nope' } })
    findMany.mockResolvedValue([etl()])

    const result = await pushTasksForLink({ link: LINK, token: 't' })

    expect(result).toMatchObject({ pushed: 0, skipped: 1 })
    expect(update).not.toHaveBeenCalled()
  })

  it('skips a malformed remoteId rather than PATCHing a wrong issue number', async () => {
    findMany.mockResolvedValue([etl({ remoteId: 'owner/repo#not-a-number' })])

    expect(await pushTasksForLink({ link: LINK, token: 't' })).toMatchObject({ skipped: 1 })
    expect(githubRequest).not.toHaveBeenCalled()
  })
})
