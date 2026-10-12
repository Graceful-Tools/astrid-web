/**
 * A board column is written verbatim today, so a capitalised role hides a task
 * from the queue (AWTD-1198).
 *
 * WHAT WENT WRONG. On 2026-10-10 AWTD-1177 carried the literal statusRole
 * "Waiting" — the only non-lowercase role on the board, where the other 17
 * statused tasks were lowercase. `resolveStatusRoleWrite` wrote the caller's
 * string straight through, with no normalisation and no validation, and all
 * three write paths hand it the raw body value.
 *
 * WHY IT HID. Most readers are defensive (lib/ready-queue-scope.ts and
 * lib/task-dependencies.ts both `.trim().toLowerCase()`), which is why nobody
 * noticed. But app/api/v1/tasks/route.ts filters the DATABASE on the raw value,
 * so `GET /api/v1/tasks?statusRole=ready` silently omits a task stored as
 * "Ready" — invisible to exactly the server-side filtered queries the queue
 * scripts moved onto in AWTD-562. A queue that returns one task fewer reads
 * like a quiet day.
 *
 * SCOPE: case and whitespace only. Rejecting an unknown role with a 400 — the
 * other half of the task's suggested fix — is AWTD-1218, because the single
 * caller is services/task.service.ts, which sits on the oversized-files
 * ratchet at exactly 1484 lines. Returning a 400 costs it two more, and that
 * ratchet says to take the next piece out of the file rather than raise the
 * number. A spelling fix should not drag an extraction in with it.
 *
 * And note what it must NOT do when that lands: Project Mode mints per-board
 * custom columns as `custom-<slug>` (lib/project-custom-states.ts), which are
 * legitimate roles and deliberately absent from DEFAULT_STATES. The task's
 * "reject anything outside DEFAULT_STATES" would break every custom column.
 */
import { describe, it, expect } from 'vitest'
import { resolveStatusRoleWrite } from '@/services/task-status-role'

const write = (statusRole: unknown) =>
  resolveStatusRoleWrite({
    setsRole: true,
    intent: { statusRole: statusRole as string | null },
    requestedCompleted: undefined,
    existingTask: { statusRole: null, lists: [] },
    validatedListIds: undefined,
  })

describe('statusRole is normalised before it is stored (AWTD-1198)', () => {
  it('lowercases the role that actually hid a task', async () => {
    expect(await write('Waiting')).toEqual({ ok: true, data: { statusRole: 'waiting' } })
  })

  it('lowercases and trims any spelling a client sends', async () => {
    expect(await write('READY')).toEqual({ ok: true, data: { statusRole: 'ready' } })
    expect(await write('  Doing  ')).toEqual({ ok: true, data: { statusRole: 'doing' } })
  })

  it('keeps a Project Mode custom column, which is not a default role', async () => {
    expect(await write('custom-blocked')).toEqual({ ok: true, data: { statusRole: 'custom-blocked' } })
    expect(await write('Custom-Blocked')).toEqual({ ok: true, data: { statusRole: 'custom-blocked' } })
  })

  it('still clears the column when asked', async () => {
    expect(await write(null)).toEqual({ ok: true, data: { statusRole: null } })
    expect(await write('')).toEqual({ ok: true, data: { statusRole: null } })
    expect(await write('   ')).toEqual({ ok: true, data: { statusRole: null } })
  })

  it('leaves the lane to completion when the same request completes the task', async () => {
    const result = await resolveStatusRoleWrite({
      setsRole: true,
      intent: { statusRole: 'Waiting' },
      requestedCompleted: true,
      existingTask: { statusRole: null, lists: [] },
      validatedListIds: undefined,
    })
    expect(result).toEqual({ ok: true, data: {} })
  })
})
