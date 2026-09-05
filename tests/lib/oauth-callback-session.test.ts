/**
 * RED for task 842601f2.
 *
 * Integration `state` carries only the initiator's user id, so an attacker
 * could mint one for their own account and hand the victim the provider
 * authorize URL. The victim approves, and their repo-scoped token is filed onto
 * the attacker's account. When the victim's browser is signed in — which it
 * usually is — it answers the question the state cannot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUnifiedSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

const { callbackSessionConflicts } = await import('@/lib/sync/oauth-callback-session')

const request = {} as never

beforeEach(() => vi.clearAllMocks())

describe('callbackSessionConflicts', () => {
  it('refuses when the signed-in browser is a different account from the state', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: 'victim' } })

    expect(await callbackSessionConflicts(request, 'attacker', 'github')).toBe(true)
  })

  it('allows the account completing its own link', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: 'me' } })

    expect(await callbackSessionConflicts(request, 'me', 'github')).toBe(false)
  })

  it('allows a signed-out browser, which is the documented residual gap', async () => {
    getUnifiedSession.mockResolvedValue(null)

    expect(await callbackSessionConflicts(request, 'me', 'github')).toBe(false)
  })

  it('does not break a legitimate connect when the session lookup throws', async () => {
    getUnifiedSession.mockRejectedValue(new Error('cookie parse failed'))

    expect(await callbackSessionConflicts(request, 'me', 'google')).toBe(false)
  })
})
