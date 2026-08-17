/**
 * Saving a setting must actually notify the user's other devices
 * (task 9523d634).
 *
 * hooks/useUserSettings.ts:63 subscribes to the SSE event
 * `user_settings_updated`, and its header claims these settings are "synced
 * across devices via database + SSE". A repo-wide grep for that string found
 * exactly one hit — the subscriber. No route ever emitted it, so the sync was
 * a no-op and the comment was false.
 *
 * Jon's decision (a) was to keep settings online-only and fix the parts that
 * pretend to work, so the fix is to EMIT the event rather than delete the
 * subscription: the neighbouring my-tasks-preferences route already emits its
 * own event (app/api/v1/users/me/my-tasks-preferences/route.ts:99), so the
 * pattern exists and works — this one was simply never wired.
 *
 * BROADCAST TO THIS USER ONLY. These are personal preferences; every other
 * account must be unaffected. That is asserted rather than assumed, because
 * `broadcastToUsers` takes an array and passing the wrong one leaks a user's
 * settings to everybody.
 *
 * A FAILED BROADCAST MUST NOT FAIL THE SAVE. The write has already committed
 * by then; SSE is a courtesy on top.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const broadcastToUsers = vi.fn()
const userUpdate = vi.fn()

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: (...a: unknown[]) => broadcastToUsers(...a) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { update: (...a: unknown[]) => userUpdate(...a) },
    taskList: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (req: unknown, auth: unknown) => unknown) =>
    (req: unknown) => handler(req, { userId: 'user-1', source: 'session' }),
}))

const patch = (body: Record<string, unknown>) =>
  ({ json: async () => body }) as unknown as Request

beforeEach(() => {
  vi.clearAllMocks()
  userUpdate.mockResolvedValue({ subtaskDisplay: 'indented', taskDisplayMode: 'list' })
})

describe('PATCH smart-tasks notifies the user (task 9523d634)', () => {
  it('emits user_settings_updated — the event the client already listens for', async () => {
    const { PATCH } = await import('@/app/api/v1/users/me/smart-tasks/route')
    await PATCH(patch({ subtaskDisplay: 'under_parent' }))

    expect(
      broadcastToUsers,
      'the setting saved but no device was told — this is the dead sync',
    ).toHaveBeenCalled()
    const [, payload] = broadcastToUsers.mock.calls[0]
    expect(payload.type).toBe('user_settings_updated')
  })

  it('sends the saved values, so a listener can apply them without refetching', async () => {
    userUpdate.mockResolvedValue({ subtaskDisplay: 'under_parent', taskDisplayMode: 'project' })
    const { PATCH } = await import('@/app/api/v1/users/me/smart-tasks/route')
    await PATCH(patch({ subtaskDisplay: 'under_parent' }))

    const [, payload] = broadcastToUsers.mock.calls[0]
    expect(payload.data).toMatchObject({
      subtaskDisplay: 'under_parent',
      taskDisplayMode: 'project',
    })
  })

  it('broadcasts to THIS user only', async () => {
    // These are personal preferences; the array argument is how they would
    // leak to everyone.
    const { PATCH } = await import('@/app/api/v1/users/me/smart-tasks/route')
    await PATCH(patch({ subtaskDisplay: 'indented' }))

    expect(broadcastToUsers.mock.calls[0][0]).toEqual(['user-1'])
  })

  it('a broadcast failure does not fail the save', async () => {
    // The write has already committed; SSE is a courtesy on top of it.
    broadcastToUsers.mockImplementation(() => {
      throw new Error('SSE is down')
    })
    const { PATCH } = await import('@/app/api/v1/users/me/smart-tasks/route')
    const response = await PATCH(patch({ subtaskDisplay: 'indented' }))

    expect(response.status).toBe(200)
  })
})
