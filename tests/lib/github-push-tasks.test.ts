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
const updateMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { externalTaskLink: { findMany, update, updateMany } },
}))

const githubRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/github', () => ({ githubRequest }))

import {
  pushTasksForLink,
  directionPulls,
  directionPushes,
  MAX_LINKS_SCANNED_PER_PASS,
  MAX_PUSHES_PER_PASS,
} from '@/lib/sync/github/push-tasks'

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

/**
 * Task f9ba26b3 — bounding the outbound scan.
 *
 * This loaded EVERY ExternalTaskLink for the container with no `take`, joined
 * to its task, and then PATCHed one issue at a time with no cap.
 * MAX_LINKS_PER_PASS bounds the number of links a pass touches, not the work
 * inside any one of them, so a repo with thousands of linked issues could eat
 * the whole 60-second budget by itself.
 *
 * The trap in bounding it is the one `sync-all-links.ts` already documents for
 * its own scan: add a `take` without a rotating order and Postgres hands back
 * the same prefix on all 96 runs a day, so the tail is never examined. Which is
 * why the pass stamps everything it LOOKED at, not only what it changed.
 */
describe('pushTasksForLink bounds and rotates its scan (task f9ba26b3)', () => {
  const manyLinks = (count: number, over: (i: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: count }, (_, i) =>
      etl({ id: `etl-${i}`, remoteId: `owner/repo#${i}`, ...over(i) }),
    )

  it('asks for a bounded page instead of the whole container', async () => {
    findMany.mockResolvedValue([])

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_LINKS_SCANNED_PER_PASS }),
    )
  })

  it('orders the scan so it ROTATES rather than re-reading one prefix forever', async () => {
    findMany.mockResolvedValue([])

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      }),
    )
  })

  it('caps the GitHub round trips one link may spend in a single pass', async () => {
    findMany.mockResolvedValue(manyLinks(MAX_PUSHES_PER_PASS + 20))

    const result = await pushTasksForLink({ link: LINK, token: 't' })

    expect(githubRequest).toHaveBeenCalledTimes(MAX_PUSHES_PER_PASS)
    expect(result.pushed).toBe(MAX_PUSHES_PER_PASS)
    expect(result.capped).toBe(true)
  })

  it('leaves the links it never reached UNSTAMPED, so the next pass starts there', async () => {
    findMany.mockResolvedValue(manyLinks(MAX_PUSHES_PER_PASS + 20))

    await pushTasksForLink({ link: LINK, token: 't' })

    // Only examined rows may rotate to the back. Stamping the unreached ones
    // would push them behind the links we just handled and strand them exactly
    // as the missing `take` did.
    const stamped = updateMany.mock.calls.flatMap(
      ([arg]: [{ where: { id: { in: string[] } } }]) => arg.where.id.in,
    )
    expect(stamped).not.toContain(`etl-${MAX_PUSHES_PER_PASS + 5}`)
  })

  it('stamps UNCHANGED links in one updateMany so they rotate to the back', async () => {
    // The starvation case: an unchanged link costs no network, so without a
    // stamp it keeps its old lastSyncedAt, sits at the front of every pass and
    // the tail behind it is never examined.
    findMany.mockResolvedValue(manyLinks(3, () => ({ astridUpdatedAt: NEW })))

    const result = await pushTasksForLink({ link: LINK, token: 't' })

    expect(result).toMatchObject({ skipped: 3, pushed: 0 })
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['etl-0', 'etl-1', 'etl-2'] } },
        data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
      }),
    )
  })

  it('rotates a link whose push FAILED without touching its watermarks', async () => {
    // A permanently failing push must not re-consume the budget at the front of
    // every pass. lastSyncedAt is safe to move because nothing reads it —
    // astridUpdatedAt and remoteUpdatedAt are the watermarks, and they stay put.
    githubRequest.mockResolvedValue({ status: 422, json: { message: 'nope' } })
    findMany.mockResolvedValue(manyLinks(1))

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(update).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['etl-0'] } } }),
    )
  })

  it('does not issue a stamping query when there is nothing to stamp', async () => {
    findMany.mockResolvedValue([])

    await pushTasksForLink({ link: LINK, token: 't' })

    expect(updateMany).not.toHaveBeenCalled()
  })
})
