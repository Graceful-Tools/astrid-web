/**
 * An unknown `statusRole` is REFUSED, not stored (AWTD-1218).
 *
 * The other half of [AWTD-1198](https://astrid.cc/t/AWTD-1198), which fixed the
 * reported bug — a capitalised role hid a task from
 * `GET /api/v1/tasks?statusRole=ready` — by normalising case and whitespace.
 * What it did not do is reject a role that does not exist, so
 * `update_task { statusRole: 'nonsense' }` succeeded and stored it. The task
 * then sits in no column on any board, visible only to a query that asks for
 * that exact string.
 *
 * **What the rule must NOT be.** The original task proposed "reject anything
 * not in DEFAULT_STATES". That would break Project Mode: `mintRole` in
 * lib/project-custom-states.ts creates per-board columns as `custom-<slug>`,
 * which are legitimate roles and deliberately absent from DEFAULT_STATES.
 *
 * So the rule is: the three defaults, or a `custom-` prefixed role. Whether a
 * given `custom-` role exists on *that task's* board is a deeper check needing
 * the project, and a wrong answer there rejects a legitimate write — worse than
 * storing a role no column happens to show.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { taskList: { findMany: vi.fn(async () => []) } } }))

import { resolveStatusRoleWrite } from '@/services/task-status-role'

const base = {
  requestedCompleted: undefined,
  existingTask: { statusRole: null, lists: [] },
  validatedListIds: undefined,
}

const write = (statusRole: string | null) =>
  resolveStatusRoleWrite({ ...base, setsRole: true, intent: { statusRole } })

describe('resolveStatusRoleWrite rejects an unknown role (AWTD-1218)', () => {
  it.each(['ready', 'doing', 'waiting'])('accepts the default role %s', async role => {
    expect(await write(role)).toEqual({ ok: true, data: { statusRole: role } })
  })

  it.each(['Ready', '  WAITING  ', 'Doing'])('accepts %s once normalised', async role => {
    expect(await write(role)).toMatchObject({ ok: true })
  })

  it('accepts a Project Mode custom column', async () => {
    // mintRole's shape. Rejecting these would break every board with a column
    // of its own — the mistake the task warns about by name.
    expect(await write('custom-blocked')).toEqual({ ok: true, data: { statusRole: 'custom-blocked' } })
  })

  it('accepts a custom role whatever its slug, since the board owns the vocabulary', async () => {
    expect(await write('custom-waiting-on-legal-2')).toMatchObject({ ok: true })
  })

  it('REFUSES a role that is neither a default nor custom-prefixed', async () => {
    expect(await write('nonsense')).toEqual({
      ok: false,
      status: 400,
      error: expect.stringContaining('nonsense'),
    })
  })

  it.each(['done', 'Done', 'backlog', 'in-progress', 'custom', 'customblocked'])(
    'refuses %s',
    async role => {
      // `done` is derived from `completed` and is not a role; `custom` and
      // `customblocked` miss the hyphen and so are not minted columns.
      expect(await write(role)).toMatchObject({ ok: false, status: 400 })
    },
  )

  it('still clears the role on null, which is Inbox', async () => {
    expect(await write(null)).toEqual({ ok: true, data: { statusRole: null } })
  })

  it('still clears the role on an empty or whitespace string', async () => {
    expect(await write('   ')).toEqual({ ok: true, data: { statusRole: null } })
  })

  it('writes no role at all when the same request completes the task', async () => {
    // Completion owns the lane; an unknown role alongside it is not a reason to
    // refuse a completion.
    expect(
      await resolveStatusRoleWrite({
        ...base,
        setsRole: true,
        intent: { statusRole: 'nonsense' },
        requestedCompleted: true,
      }),
    ).toEqual({ ok: true, data: {} })
  })

  it('is unaffected when the request does not name a role', async () => {
    expect(
      await resolveStatusRoleWrite({ ...base, setsRole: false, intent: {} }),
    ).toEqual({ ok: true, data: {} })
  })
})
