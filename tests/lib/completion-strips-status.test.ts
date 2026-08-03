import { describe, expect, it } from 'vitest'
import { statusListIdsToDetachOnCompletion } from '@/lib/project-status'

/**
 * Task db7c6670 — `completed = true => no status memberships`.
 *
 * The task was filed as a data cleanup ("9 stale rows that predate the
 * invariant being enforced on every write path"). It isn't. The write path
 * never enforced it for a completion-only update:
 *
 *   normalizeProjectStatusListIds() does strip status lists when completing,
 *   but every route gates it behind `if (body.listIds !== undefined)`. A
 *   `PUT { completed: true }` — which is how the API, the checkbox and the
 *   scripts complete a task — skips the block entirely, so the membership
 *   survives and a NEW violation is written.
 *
 * Reproduced on production 2026-08-02: completing task 4c2d2f6f via
 * `PUT /api/v1/tasks/<id> { completed: true }` left it attached to "Ready".
 *
 * This is the pure decision the routes now consult on that path.
 */
const READY = { id: 'ready', listType: 'status' as const, name: 'Ready' }
const DOING = { id: 'doing', listType: 'status' as const, name: 'Doing' }
const WORK = { id: 'work', listType: null, name: 'Work' }
const HOME = { id: 'home', listType: 'regular' as const, name: 'Home' }

describe('statusListIdsToDetachOnCompletion (task db7c6670)', () => {
  it('detaches the status list a completed task was sitting in', () => {
    expect(statusListIdsToDetachOnCompletion([READY, WORK] as never))
      .toEqual(['ready'])
  })

  it('keeps every non-status list — completing a task does not unfile it', () => {
    const detached = statusListIdsToDetachOnCompletion([READY, WORK, HOME] as never)

    expect(detached).not.toContain('work')
    expect(detached).not.toContain('home')
  })

  it('detaches all of them if a task somehow holds more than one status', () => {
    expect(statusListIdsToDetachOnCompletion([READY, DOING, WORK] as never).sort())
      .toEqual(['doing', 'ready'])
  })

  it('returns nothing when the task holds no status membership', () => {
    expect(statusListIdsToDetachOnCompletion([WORK, HOME] as never)).toEqual([])
  })

  it('returns nothing for a task on no lists at all', () => {
    expect(statusListIdsToDetachOnCompletion([])).toEqual([])
  })

  it('tolerates a missing or null list relation rather than throwing mid-update', () => {
    expect(statusListIdsToDetachOnCompletion(undefined as never)).toEqual([])
    expect(statusListIdsToDetachOnCompletion(null as never)).toEqual([])
  })

  it('agrees with normalizeProjectStatusListIds — same invariant, two entry points', async () => {
    const { normalizeProjectStatusListIds } = await import('@/lib/project-status')
    const lists = [READY, DOING, WORK] as never

    // The listIds path: completing strips every status list from the request.
    const viaNormalize = normalizeProjectStatusListIds(
      ['ready', 'doing', 'work'], lists, { completed: true },
    ).listIds

    // The completion-only path: same end state, expressed as a detach set.
    const detach = new Set(statusListIdsToDetachOnCompletion(lists))
    const viaDetach = ['ready', 'doing', 'work'].filter(id => !detach.has(id))

    expect(viaDetach).toEqual(viaNormalize)
  })
})
