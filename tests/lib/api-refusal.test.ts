/**
 * Surfacing the server's reason for refusing a write (AWTD-887).
 *
 * An optimistic update that the server refuses is rolled back, so the field the
 * user just set snaps to its previous value. With only "Failed to update task.
 * Please try again." to go on, that reads as a glitch rather than a rule — and
 * that is how an agent assignment being refused went unexplained: the assignee
 * reverted to whoever it was before and nothing said why.
 */

import { describe, it, expect } from 'vitest'
import { ApiError, refusalReason } from '@/lib/api'

const apiError = (status: number, detail: unknown) =>
  new ApiError('API call failed', status, '/api/v1/tasks/task-1', detail, null)

describe('refusalReason (AWTD-887)', () => {
  it('returns the reason a 4xx gave', () => {
    const reason = refusalReason(
      apiError(403, {
        error: 'Only the task creator, or a list owner or admin, can assign an AI agent to this task',
      }),
    )

    expect(reason).toBe(
      'Only the task creator, or a list owner or admin, can assign an AI agent to this task',
    )
  })

  it('says nothing for a 5xx', () => {
    // An internal failure's message is not the caller's business, and "try
    // again" is genuinely the right advice there.
    expect(refusalReason(apiError(500, { error: 'Internal server error' }))).toBeNull()
  })

  it('says nothing when the body carried no error string', () => {
    expect(refusalReason(apiError(400, { message: 'nope' }))).toBeNull()
    expect(refusalReason(apiError(400, 'plain text'))).toBeNull()
    expect(refusalReason(apiError(400, null))).toBeNull()
  })

  it('treats a blank error string as no reason at all', () => {
    // Better the generic sentence than an empty toast.
    expect(refusalReason(apiError(400, { error: '   ' }))).toBeNull()
  })

  it('says nothing for an error that is not an ApiError', () => {
    expect(refusalReason(new Error('network down'))).toBeNull()
    expect(refusalReason('not even an error')).toBeNull()
  })
})
